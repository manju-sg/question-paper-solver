import { z } from "zod";

export const extractedQuestionSchema = z.object({
  id: z.string().min(1),
  questionNumber: z.string().min(1),
  topic: z.string().min(1),
  marks: z.string().min(1),
  questionText: z.string().min(1),
});

export type ExtractedQuestion = z.infer<typeof extractedQuestionSchema>;

export const solutionItemSchema = z.object({
  id: z.string().min(1),
  questionNumber: z.string().min(1),
  topic: z.string().min(1),
  marks: z.string().min(1),
  questionText: z.string().min(1),
  answerMarkdown: z.string().min(1),
  finalAnswer: z.string().min(1),
  diagramMermaid: z.string().optional().default(""),
  chemicalStructures: z
    .array(
      z.object({
        title: z.string().min(1),
        smiles: z.string().min(1),
        caption: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
  confidence: z.enum(["high", "medium", "low"]),
});

export type SolutionItem = z.infer<typeof solutionItemSchema>;

export const questionPaperDraftSchema = z.object({
  paperTitle: z.string().min(1),
  subject: z.string().min(1),
  overviewMarkdown: z.string().min(1),
  studyTipsMarkdown: z.string().min(1),
  questions: z.array(extractedQuestionSchema).min(1),
});

export type QuestionPaperDraft = z.infer<typeof questionPaperDraftSchema>;

export const solutionChunkSchema = z.object({
  solutions: z.array(solutionItemSchema).min(1),
});

export type SolutionChunk = z.infer<typeof solutionChunkSchema>;

export const questionPaperSolutionSchema = z.object({
  paperTitle: z.string().min(1),
  subject: z.string().min(1),
  overviewMarkdown: z.string().min(1),
  studyTipsMarkdown: z.string().min(1),
  solutions: z.array(solutionItemSchema).min(1),
});

export type QuestionPaperSolution = z.infer<typeof questionPaperSolutionSchema>;

export const solverMetaSchema = z.object({
  model: z.string().min(1),
  usedKeyIndex: z.number().int().positive(),
});

export type SolverMeta = z.infer<typeof solverMetaSchema>;

export const solveJobStageSchema = z.enum([
  "queued",
  "uploading",
  "extracting",
  "solving",
  "finalizing",
  "completed",
  "failed",
]);

export type SolveJobStage = z.infer<typeof solveJobStageSchema>;

export const solveJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export type SolveJobStatus = z.infer<typeof solveJobStatusSchema>;

export const solveJobSnapshotSchema = z.object({
  jobId: z.string().min(1),
  sourceFileName: z.string().min(1),
  status: solveJobStatusSchema,
  stage: solveJobStageSchema,
  progress: z.number().min(0).max(100),
  message: z.string().min(1),
  totalQuestions: z.number().int().nonnegative().nullable(),
  solvedQuestions: z.number().int().nonnegative(),
  draft: questionPaperDraftSchema.nullable(),
  partialSolutions: z.array(solutionItemSchema),
  result: questionPaperSolutionSchema.nullable(),
  meta: solverMetaSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type SolveJobSnapshot = z.infer<typeof solveJobSnapshotSchema>;

export const solveHistoryItemSchema = z.object({
  jobId: z.string().min(1),
  sourceFileName: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  previewText: z.string().min(1),
  status: solveJobStatusSchema,
  stage: solveJobStageSchema,
  progress: z.number().min(0).max(100),
  totalQuestions: z.number().int().nonnegative().nullable(),
  solvedQuestions: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type SolveHistoryItem = z.infer<typeof solveHistoryItemSchema>;

export const solveHistoryListSchema = z.array(solveHistoryItemSchema);

const extractedQuestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      description: "A stable id like q1, q2, q3.",
    },
    questionNumber: {
      type: "string",
      description: "The exact question number or label from the paper.",
    },
    topic: {
      type: "string",
      description: "The best-fit topic or chapter for this question.",
    },
    marks: {
      type: "string",
      description: "Visible marks or 'Not specified'.",
    },
    questionText: {
      type: "string",
      description:
        "A clean transcription of the question with equations and symbols preserved.",
    },
  },
  required: ["id", "questionNumber", "topic", "marks", "questionText"],
} as const;

export const questionPaperDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    paperTitle: {
      type: "string",
      description: "A polished title for the uploaded question paper.",
    },
    subject: {
      type: "string",
      description: "The likely subject, course, or exam name.",
    },
    overviewMarkdown: {
      type: "string",
      description:
        "A short markdown overview of what the paper covers. LaTeX is allowed.",
    },
    studyTipsMarkdown: {
      type: "string",
      description:
        "A concise markdown revision guide based on the paper's patterns. LaTeX is allowed.",
    },
    questions: {
      type: "array",
      minItems: 1,
      items: extractedQuestionJsonSchema,
    },
  },
  required: [
    "paperTitle",
    "subject",
    "overviewMarkdown",
    "studyTipsMarkdown",
    "questions",
  ],
} as const;

const solutionItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      description: "Must exactly match the extracted question id.",
    },
    questionNumber: {
      type: "string",
      description: "Must exactly match the extracted question number.",
    },
    topic: {
      type: "string",
      description: "The main topic or chapter tested by the question.",
    },
    marks: {
      type: "string",
      description: "Visible marks or an estimate such as 'Not specified'.",
    },
    questionText: {
      type: "string",
      description: "The full question text that is being solved.",
    },
    answerMarkdown: {
      type: "string",
      description:
        "A beautifully formatted step-by-step solution in markdown. Use LaTeX for equations and keep it exam friendly.",
    },
    finalAnswer: {
      type: "string",
      description: "A short final answer or concluding statement.",
    },
    chemicalStructures: {
      type: "array",
      description:
        "Use this for chemistry questions when a skeletal or structural diagram would help. Each item must contain a short title, a valid SMILES string, and an optional caption. Return an empty array when no compound structure is needed or when you are unsure of the structure.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description: "A short label such as Benzene, Ethanol, or Product.",
          },
          smiles: {
            type: "string",
            description:
              "A valid SMILES string for the compound so the UI can render a line structure. Use charged nitro notation such as [N+](=O)[O-] or O=[N+]([O-]).",
          },
          caption: {
            type: "string",
            description:
              "A brief note such as reactant, intermediate, product, or why this structure matters.",
          },
        },
        required: ["title", "smiles", "caption"],
      },
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Confidence based on readability and certainty.",
    },
  },
  required: [
    "id",
    "questionNumber",
    "topic",
    "marks",
    "questionText",
    "answerMarkdown",
    "finalAnswer",
    "chemicalStructures",
    "confidence",
  ],
} as const;

export const solutionChunkJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    solutions: {
      type: "array",
      minItems: 1,
      items: solutionItemJsonSchema,
    },
  },
  required: ["solutions"],
} as const;

export const questionPaperSolutionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    paperTitle: {
      type: "string",
      description: "A polished title for the uploaded question paper.",
    },
    subject: {
      type: "string",
      description: "The likely subject, course, or exam name.",
    },
    overviewMarkdown: {
      type: "string",
      description:
        "A short markdown overview of the paper. LaTeX is allowed with $inline$ and $$block$$ syntax.",
    },
    studyTipsMarkdown: {
      type: "string",
      description:
        "A concise markdown study guide with traps, revision tips, or patterns noticed in the paper.",
    },
    solutions: {
      type: "array",
      minItems: 1,
      items: solutionItemJsonSchema,
    },
  },
  required: [
    "paperTitle",
    "subject",
    "overviewMarkdown",
    "studyTipsMarkdown",
    "solutions",
  ],
} as const;
