import {
  questionPaperDraftJsonSchema,
  questionPaperDraftSchema,
  questionPaperSolutionSchema,
  solutionChunkJsonSchema,
  solutionChunkSchema,
  type ExtractedQuestion,
  type QuestionPaperDraft,
  type QuestionPaperSolution,
  type SolutionItem,
  type SolveJobStage,
} from "@/lib/solution-schema";
import {
  cleanInlineText,
  cleanMarkdownText,
  normalizeDraftContent,
  normalizeSolutionContent,
} from "@/lib/solution-formatting";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 24;
const QUESTION_BATCH_SIZE = 3;

type SolveQuestionPaperArgs = {
  fileBlob: Blob;
  fileName: string;
  notes?: string;
};

type ContinueQuestionPaperArgs = {
  fileBlob?: Blob;
  fileName: string;
  notes?: string;
  draft: QuestionPaperDraft;
  partialSolutions?: SolutionItem[];
  targetQuestionIds?: string[];
};

type FilesCapableClient = {
  files: {
    get: (args: { name: string }) => Promise<{
      state?: unknown;
      uri?: string | null;
      mimeType?: string | null;
    }>;
    upload: (args: {
      file: Blob;
      config: {
        displayName: string;
        mimeType: string;
      };
    }) => Promise<{ name?: string | null }>;
  };
  models: {
    generateContent: (args: any) => Promise<{ text?: string }>;
  };
};

type GeminiContext = {
  ai: FilesCapableClient;
  createPartFromUri: (uri: string, mimeType: string) => unknown;
  createUserContent: (parts: any) => unknown;
  processedFile?: {
    uri: string;
    mimeType: string;
  };
  usedKeyIndex: number;
};

export type SolveProgressUpdate = {
  stage: SolveJobStage;
  progress: number;
  message: string;
  draft?: QuestionPaperDraft;
  partialSolutions?: SolutionItem[];
  totalQuestions?: number;
  solvedQuestions?: number;
  meta?: {
    model: string;
    usedKeyIndex: number;
  };
};

type SolveQuestionPaperProgressArgs = SolveQuestionPaperArgs & {
  onProgress?: (update: SolveProgressUpdate) => void;
};

type ContinueQuestionPaperProgressArgs = ContinueQuestionPaperArgs & {
  onProgress?: (update: SolveProgressUpdate) => void;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getGeminiKeys() {
  return [
    { slot: 1, value: process.env.GEMINI_API_KEY_1 },
    { slot: 2, value: process.env.GEMINI_API_KEY_2 },
    { slot: 3, value: process.env.GEMINI_API_KEY_3 },
    { slot: 4, value: process.env.GEMINI_API_KEY_4 },
    { slot: 5, value: process.env.GEMINI_API_KEY_5 },
  ]
    .map(({ slot, value }) => ({
      slot,
      key: value?.trim(),
    }))
    .filter((entry): entry is { slot: number; key: string } => Boolean(entry.key));
}

function reportProgress(
  onProgress: SolveQuestionPaperProgressArgs["onProgress"],
  update: SolveProgressUpdate,
) {
  onProgress?.(update);
}

function parseJsonResponse(rawText: string, emptyMessage: string) {
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!cleanedText) {
    throw new Error(emptyMessage);
  }

  try {
    return JSON.parse(cleanedText);
  } catch {
    const objectStart = cleanedText.indexOf("{");
    const objectEnd = cleanedText.lastIndexOf("}");

    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(cleanedText.slice(objectStart, objectEnd + 1));
    }

    throw new Error("Gemini returned JSON that could not be parsed cleanly.");
  }
}

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "An unknown Gemini error occurred.";
  }

  const message = error.message || "Gemini returned an error.";

  if (/fetch failed|network|enotfound|econnreset|etimedout|eai_again/i.test(message)) {
    return "Could not reach Gemini. Check your internet connection, VPN/proxy, and API access.";
  }

  if (/api key|permission|unauthorized|forbidden|quota|rate/i.test(message)) {
    return message;
  }

  return message;
}

function buildExtractionPrompt(notes?: string) {
  return [
    "You are extracting questions from an uploaded question-paper PDF.",
    "Do not solve the paper yet.",
    "Return JSON that matches the provided schema exactly.",
    "Identify each distinct answerable question or sub-question that should receive its own worked solution.",
    "Read figures, tables, options, chemical structures, and handwritten-looking labels when they are visible.",
    "Ignore ornamental cover text and focus on content students would answer.",
    "Preserve original numbering when possible.",
    "Write questionText as a clean, self-contained prompt with equations, options, symbols, and figure descriptions preserved.",
    "Repair OCR artifacts: use →, ↔, ¬, ∧, ∨, ∀, ∃, ≤, ≥, ≠, and proper LaTeX instead of mojibake text.",
    "Use 'Not specified' when marks are not visible.",
    notes
      ? `The final answer style preferences from the user are: ${notes}`
      : "No additional answer-style notes were provided.",
  ].join("\n");
}

function buildSolvePrompt(
  draft: QuestionPaperDraft,
  questions: ExtractedQuestion[],
  notes?: string,
) {
  return [
    "You are an expert academic question-paper solver.",
    "The original PDF is attached again; use it to verify diagrams, options, tables, equations, and scanned symbols before answering.",
    "Solve only the questions listed below and return JSON that matches the provided schema exactly.",
    "Use the provided ids, question numbers, topics, marks, and question text exactly as given.",
    "For every solution:",
    "- Write clean, exam-ready markdown with short titled sections.",
    "- Start with the method or formula, then show the step-by-step solution, then add a tiny exam note only if useful.",
    "- Use tables for truth tables, comparisons, match-the-following, algorithms, and case analysis.",
    "- Render equations using LaTeX with $...$ for inline math and $$...$$ for important displayed steps.",
    "- Every display equation must include both opening and closing $$ delimiters; never leave raw \\frac, \\begin{pmatrix}, \\end{pmatrix}, or other LaTeX commands outside math delimiters.",
    "- For large derivative lists, use compact Markdown tables plus one final matrix instead of repeating the same formula as broken plain text.",
    "- Use aligned equations for derivations when that improves readability.",
    "- For chemistry formulas or reaction equations, use LaTeX chemistry notation such as \\ce{H2SO4} when it improves readability.",
    "- Do not include a 'Final Answer' heading inside answerMarkdown because finalAnswer is rendered separately.",
    "- Repair OCR artifacts and symbols before solving. Never leave text like Â¬, â†’, â€“, or â‡”.",
    "- Keep the explanation structured, neat, and revision friendly.",
    "- Do not output Mermaid, flowchart syntax, graph syntax, or any diagram code.",
    "- Keep diagramMermaid empty if it is present in older examples you have seen.",
    "- When an organic or chemistry question would benefit from a structural diagram, populate chemicalStructures with valid SMILES strings that represent the actual compounds students should study.",
    "- For nitro groups in SMILES, use charged notation like [N+](=O)[O-] or O=[N+]([O-]); do not use neutral N(=O)=O or O=N([O-]).",
    "- Use chemicalStructures as an empty array when no structure is needed or when you are not confident in the exact structure.",
    "- If the extracted question looks ambiguous, briefly acknowledge that inside the answer and solve the most likely interpretation.",
    notes
      ? `User formatting instructions: ${notes}`
      : "No extra formatting instructions were provided.",
    `Paper title: ${draft.paperTitle}`,
    `Subject: ${draft.subject}`,
    "Questions to solve:",
    JSON.stringify(questions, null, 2),
  ].join("\n");
}

function normalizeDraft(draft: QuestionPaperDraft) {
  const seen = new Set<string>();
  const normalizedDraft = normalizeDraftContent(draft);

  const questions = normalizedDraft.questions
    .filter((question) => {
      const key = `${question.questionNumber}::${question.questionText}`.toLowerCase();

      if (seen.has(key) || !question.questionText) {
        return false;
      }

      seen.add(key);
      return true;
    });

  return questionPaperDraftSchema.parse({
    ...normalizedDraft,
    questions,
  });
}

function mergeSolutions(existing: SolutionItem[], incoming: SolutionItem[]) {
  const byId = new Map(existing.map((solution) => [solution.id, solution]));

  for (const solution of incoming) {
    byId.set(solution.id, solution);
  }

  return Array.from(byId.values());
}

function isFallbackSolution(solution: SolutionItem) {
  return (
    solution.confidence === "low" &&
    /could not|fallback placeholder|not include this question|not be completed/i.test(
      `${solution.answerMarkdown} ${solution.finalAnswer}`,
    )
  );
}

function getQuestionsToSolve(
  draft: QuestionPaperDraft,
  partialSolutions: SolutionItem[],
  targetQuestionIds?: string[],
) {
  if (targetQuestionIds?.length) {
    const targetIds = new Set(targetQuestionIds);
    return draft.questions.filter((question) => targetIds.has(question.id));
  }

  const solvedIds = new Set(
    partialSolutions
      .filter((solution) => !isFallbackSolution(solution))
      .map((solution) => solution.id),
  );

  return draft.questions.filter((question) => !solvedIds.has(question.id));
}

function removeTargetSolutions(
  partialSolutions: SolutionItem[],
  targetQuestionIds?: string[],
) {
  if (!targetQuestionIds?.length) {
    return partialSolutions;
  }

  const targetIds = new Set(targetQuestionIds);
  return partialSolutions.filter((solution) => !targetIds.has(solution.id));
}

function removeMermaidFences(markdown: string) {
  return cleanMarkdownText(markdown).replace(/```mermaid[\s\S]*?```/gi, "").trim();
}

function sanitizeSolution(solution: SolutionItem): SolutionItem {
  return normalizeSolutionContent({
    ...solution,
    id: cleanInlineText(solution.id),
    questionNumber: cleanInlineText(solution.questionNumber),
    topic: cleanInlineText(solution.topic),
    marks: cleanInlineText(solution.marks),
    questionText: removeMermaidFences(solution.questionText),
    answerMarkdown: removeMermaidFences(solution.answerMarkdown),
    finalAnswer: removeMermaidFences(solution.finalAnswer),
    diagramMermaid: "",
  });
}

function createFallbackSolution(question: ExtractedQuestion, reason: string): SolutionItem {
  return {
    id: question.id,
    questionNumber: question.questionNumber,
    topic: question.topic,
    marks: question.marks,
    questionText: question.questionText,
    answerMarkdown: `The solver could not generate a confident worked answer for this question.\n\n${reason}`,
    finalAnswer: "Answer could not be completed confidently.",
    diagramMermaid: "",
    chemicalStructures: [],
    confidence: "low",
  };
}

function finalizeResult(
  draft: QuestionPaperDraft,
  solutions: SolutionItem[],
): QuestionPaperSolution {
  const solutionMap = new Map(solutions.map((solution) => [solution.id, solution]));

  return questionPaperSolutionSchema.parse({
    paperTitle: draft.paperTitle,
    subject: draft.subject,
    overviewMarkdown: draft.overviewMarkdown,
    studyTipsMarkdown: draft.studyTipsMarkdown,
    solutions: draft.questions.map((question) => {
      const existing = solutionMap.get(question.id);

      return (
        existing ??
        createFallbackSolution(
          question,
          "A later batch did not return a usable answer, so this question is left as a placeholder.",
        )
      );
    }),
  });
}

async function waitForProcessedFile(
  ai: FilesCapableClient,
  name: string,
  onTick?: (attempt: number) => void,
) {
  let file = await ai.files.get({ name });

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const state = `${file.state ?? ""}`.toUpperCase();

    if (state === "ACTIVE" || state === "SUCCEEDED" || state === "READY") {
      return file;
    }

    if (state === "FAILED") {
      throw new Error("Gemini could not process the uploaded PDF.");
    }

    onTick?.(attempt + 1);
    await sleep(POLL_INTERVAL_MS);
    file = await ai.files.get({ name });
  }

  throw new Error("Gemini took too long to finish processing the uploaded PDF.");
}

async function uploadPdfForKey(
  key: { slot: number; key: string },
  args: SolveQuestionPaperArgs,
  onProgress?: SolveQuestionPaperProgressArgs["onProgress"],
): Promise<GeminiContext> {
  const { GoogleGenAI, createPartFromUri, createUserContent } =
    await import("@google/genai");

  const ai = new GoogleGenAI({ apiKey: key.key });

  reportProgress(onProgress, {
    stage: "uploading",
    progress: 8,
    message: `Connecting to Gemini with key slot #${key.slot}...`,
    meta: {
      model: DEFAULT_MODEL,
      usedKeyIndex: key.slot,
    },
  });

  const uploadedFile = await ai.files.upload({
    file: args.fileBlob,
    config: {
      displayName: args.fileName,
      mimeType: "application/pdf",
    },
  });

  if (!uploadedFile.name) {
    throw new Error("Gemini uploaded the PDF but did not return a file id.");
  }

  reportProgress(onProgress, {
    stage: "uploading",
    progress: 14,
    message: "Uploading complete. Gemini is processing the PDF pages now...",
    meta: {
      model: DEFAULT_MODEL,
      usedKeyIndex: key.slot,
    },
  });

  const processedFile = await waitForProcessedFile(ai, uploadedFile.name, (attempt) => {
    reportProgress(onProgress, {
      stage: "uploading",
      progress: Math.min(24, 14 + attempt),
      message: `Preparing PDF pages inside Gemini... (${attempt}/${MAX_POLL_ATTEMPTS})`,
      meta: {
        model: DEFAULT_MODEL,
        usedKeyIndex: key.slot,
      },
    });
  });

  if (!processedFile.uri || !processedFile.mimeType) {
    throw new Error("Gemini did not return a usable file reference.");
  }

  return {
    ai,
    createPartFromUri,
    createUserContent,
    processedFile: {
      uri: processedFile.uri,
      mimeType: processedFile.mimeType,
    },
    usedKeyIndex: key.slot,
  };
}

async function createTextOnlyContextForKey(
  key: { slot: number; key: string },
  onProgress?: ContinueQuestionPaperProgressArgs["onProgress"],
): Promise<GeminiContext> {
  const { GoogleGenAI, createPartFromUri, createUserContent } =
    await import("@google/genai");

  reportProgress(onProgress, {
    stage: "uploading",
    progress: 14,
    message: `Connecting to Gemini with key slot #${key.slot}; using the already extracted questions without re-reading the PDF...`,
    meta: {
      model: DEFAULT_MODEL,
      usedKeyIndex: key.slot,
    },
  });

  return {
    ai: new GoogleGenAI({ apiKey: key.key }),
    createPartFromUri,
    createUserContent,
    usedKeyIndex: key.slot,
  };
}

async function extractQuestionPaper(
  context: GeminiContext,
  notes?: string,
) {
  if (!context.processedFile) {
    throw new Error("The PDF must be uploaded before extracting questions.");
  }

  const response = await context.ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: context.createUserContent([
      context.createPartFromUri(
        context.processedFile.uri,
        context.processedFile.mimeType,
      ),
      buildExtractionPrompt(notes),
    ]),
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseJsonSchema: questionPaperDraftJsonSchema,
    },
  });

  const rawText = response.text?.trim() ?? "";
  const parsed = parseJsonResponse(
    rawText,
    "Gemini did not return extracted questions for this PDF.",
  );

  return normalizeDraft(questionPaperDraftSchema.parse(parsed));
}

async function solveQuestionBatch(
  context: GeminiContext,
  draft: QuestionPaperDraft,
  questions: ExtractedQuestion[],
  notes?: string,
) {
  const contentParts = context.processedFile
    ? [
        context.createPartFromUri(
          context.processedFile.uri,
          context.processedFile.mimeType,
        ),
        buildSolvePrompt(draft, questions, notes),
      ]
    : [buildSolvePrompt(draft, questions, notes)];

  const response = await context.ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: context.createUserContent(contentParts),
    config: {
      temperature: 0.15,
      responseMimeType: "application/json",
      responseJsonSchema: solutionChunkJsonSchema,
    },
  });

  const rawText = response.text?.trim() ?? "";
  const parsed = solutionChunkSchema.parse(
    parseJsonResponse(rawText, "Gemini returned an empty answer batch."),
  );
  const allowedIds = new Set(questions.map((question) => question.id));

  const filteredSolutions = parsed.solutions.filter((solution) =>
    allowedIds.has(solution.id),
  );

  return questions.map((question) => {
    const matched = filteredSolutions.find((solution) => solution.id === question.id);

    return (
      (matched ? sanitizeSolution(matched) : null) ??
      createFallbackSolution(
        question,
        "The batch response did not include this question, so a fallback placeholder was created.",
      )
    );
  });
}

async function solveDraftWithFailover(args: ContinueQuestionPaperProgressArgs) {
  const keys = getGeminiKeys();

  if (keys.length === 0) {
    throw new Error(
      "No Gemini API keys were found. Add GEMINI_API_KEY_1 to GEMINI_API_KEY_5 in your environment file.",
    );
  }

  let lastError: unknown;
  const draft = normalizeDraft(args.draft);
  let partialSolutions = removeTargetSolutions(
    args.partialSolutions ?? [],
    args.targetQuestionIds,
  ).map(normalizeSolutionContent);
  const totalQuestions = draft.questions.length;

  if (args.fileBlob && args.fileBlob.size > MAX_FILE_BYTES) {
    throw new Error("The uploaded PDF exceeds Gemini's 50 MB file limit.");
  }

  for (const key of keys) {
    try {
      const context = args.fileBlob
        ? await uploadPdfForKey(
            key,
            {
              fileBlob: args.fileBlob,
              fileName: args.fileName,
              notes: args.notes,
            },
            args.onProgress,
          )
        : await createTextOnlyContextForKey(key, args.onProgress);
      const meta = {
        model: DEFAULT_MODEL,
        usedKeyIndex: context.usedKeyIndex,
      };

      const questionsToSolve = getQuestionsToSolve(
        draft,
        partialSolutions,
        args.targetQuestionIds,
      );
      const questionBatches = chunkArray(questionsToSolve, QUESTION_BATCH_SIZE);

      if (questionsToSolve.length === 0) {
        const result = finalizeResult(draft, partialSolutions);

        reportProgress(args.onProgress, {
          stage: "completed",
          progress: 100,
          message: "Everything already solved. The answer sheet is ready.",
          draft,
          partialSolutions: result.solutions,
          totalQuestions,
          solvedQuestions: result.solutions.length,
          meta,
        });

        return {
          draft,
          result,
          model: DEFAULT_MODEL,
          usedKeyIndex: context.usedKeyIndex,
        };
      }

      reportProgress(args.onProgress, {
        stage: "solving",
        progress: 36,
        message:
          args.targetQuestionIds?.length === 1
            ? `Regenerating ${questionsToSolve[0].questionNumber} without re-extracting the paper...`
            : `Continuing from extracted questions. Solving ${questionsToSolve.length} remaining question${questionsToSolve.length === 1 ? "" : "s"}...`,
        draft,
        partialSolutions,
        totalQuestions,
        solvedQuestions: partialSolutions.length,
        meta,
      });

      for (let index = 0; index < questionBatches.length; index += 1) {
        const batch = questionBatches[index];
        const batchStart = index * QUESTION_BATCH_SIZE + 1;
        const batchEnd = batchStart + batch.length - 1;

        reportProgress(args.onProgress, {
          stage: "solving",
          progress: Math.round(36 + (index / questionBatches.length) * 52),
          message: `Solving extracted questions ${batchStart}-${batchEnd} of ${questionsToSolve.length}...`,
          draft,
          partialSolutions,
          totalQuestions,
          solvedQuestions: partialSolutions.length,
          meta,
        });

        const solvedBatch = await solveQuestionBatch(
          context,
          draft,
          batch,
          args.notes,
        );

        partialSolutions = mergeSolutions(partialSolutions, solvedBatch);

        reportProgress(args.onProgress, {
          stage: "solving",
          progress: Math.round(36 + ((index + 1) / questionBatches.length) * 52),
          message: `Solved ${partialSolutions.length} of ${totalQuestions} questions.`,
          draft,
          partialSolutions,
          totalQuestions,
          solvedQuestions: partialSolutions.length,
          meta,
        });
      }

      reportProgress(args.onProgress, {
        stage: "finalizing",
        progress: 94,
        message: "Finalizing the answer sheet layout, equations, and study notes...",
        draft,
        partialSolutions,
        totalQuestions,
        solvedQuestions: partialSolutions.length,
        meta,
      });

      const result = finalizeResult(draft, partialSolutions);

      reportProgress(args.onProgress, {
        stage: "completed",
        progress: 100,
        message: "Everything is ready. Scroll through the solved paper below.",
        draft,
        partialSolutions: result.solutions,
        totalQuestions,
        solvedQuestions: result.solutions.length,
        meta,
      });

      return {
        draft,
        result,
        model: DEFAULT_MODEL,
        usedKeyIndex: context.usedKeyIndex,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      lastError = new Error(errorMessage);

      reportProgress(args.onProgress, {
        stage: "uploading",
        progress: 6,
        message: `Key slot #${key.slot} failed: ${errorMessage} Trying another Gemini key without losing extracted progress...`,
        draft,
        partialSolutions,
        totalQuestions,
        solvedQuestions: partialSolutions.length,
        meta: {
          model: DEFAULT_MODEL,
          usedKeyIndex: key.slot,
        },
      });
    }
  }

  if (lastError instanceof Error) {
    throw new Error(`All configured Gemini API keys failed. Last error: ${lastError.message}`);
  }

  throw new Error("All configured Gemini API keys failed.");
}

export async function continueQuestionPaperSolving(
  args: ContinueQuestionPaperProgressArgs,
) {
  return solveDraftWithFailover(args);
}

export async function solveQuestionPaperProgressively(
  args: SolveQuestionPaperProgressArgs,
) {
  if (args.fileBlob.size > MAX_FILE_BYTES) {
    throw new Error("The uploaded PDF exceeds Gemini's 50 MB file limit.");
  }

  const keys = getGeminiKeys();

  if (keys.length === 0) {
    throw new Error(
      "No Gemini API keys were found. Add GEMINI_API_KEY_1 to GEMINI_API_KEY_5 in your environment file.",
    );
  }

  let lastError: unknown;
  let draft: QuestionPaperDraft | null = null;

  for (const key of keys) {
    try {
      const context = await uploadPdfForKey(key, args, args.onProgress);
      const meta = {
        model: DEFAULT_MODEL,
        usedKeyIndex: context.usedKeyIndex,
      };

      if (!draft) {
        reportProgress(args.onProgress, {
          stage: "extracting",
          progress: 28,
          message: "Reading the paper and extracting answerable questions...",
          meta,
        });

        draft = await extractQuestionPaper(context, args.notes);
      }

      break;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      lastError = new Error(errorMessage);

      reportProgress(args.onProgress, {
        stage: "uploading",
        progress: 6,
        message: `Key slot #${key.slot} failed while extracting: ${errorMessage} Trying another Gemini key...`,
        draft: draft ?? undefined,
        partialSolutions: [],
        totalQuestions: draft?.questions.length,
        solvedQuestions: 0,
        meta: {
          model: DEFAULT_MODEL,
          usedKeyIndex: key.slot,
        },
      });
    }
  }

  if (!draft && lastError instanceof Error) {
    throw new Error(`All configured Gemini API keys failed. Last error: ${lastError.message}`);
  }

  if (!draft) {
    throw new Error("All configured Gemini API keys failed.");
  }

  return solveDraftWithFailover({
    fileBlob: args.fileBlob,
    fileName: args.fileName,
    notes: args.notes,
    draft,
    partialSolutions: [],
    onProgress: args.onProgress,
  });
}
