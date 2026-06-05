import type {
  ExtractedQuestion,
  QuestionPaperDraft,
  QuestionPaperSolution,
  SolutionItem,
} from "@/lib/solution-schema";

const WINDOWS_1252_CODE_POINT_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const TEXT_ARTIFACT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/â€“/g, "–"],
  [/â€”/g, "—"],
  [/â€˜/g, "‘"],
  [/â€™/g, "’"],
  [/â€œ/g, "“"],
  [/â€/g, "”"],
  [/â€¦/g, "…"],
  [/â€¢/g, "•"],
  [/â†’/g, "→"],
  [/â†/g, "←"],
  [/â‡’/g, "⇒"],
  [/â‡”/g, "⇔"],
  [/â‰¤/g, "≤"],
  [/â‰¥/g, "≥"],
  [/â‰ /g, "≠"],
  [/âˆ’/g, "−"],
  [/âˆš/g, "√"],
  [/âˆž/g, "∞"],
  [/âˆ€/g, "∀"],
  [/âˆƒ/g, "∃"],
  [/âˆ§/g, "∧"],
  [/âˆ¨/g, "∨"],
  [/âˆˆ/g, "∈"],
  [/Â¬/g, "¬"],
  [/Â±/g, "±"],
  [/Â°/g, "°"],
  [/Â·/g, "·"],
  [/Â×/g, "×"],
  [/Ã—/g, "×"],
  [/Ã·/g, "÷"],
  [/Î±/g, "α"],
  [/Î²/g, "β"],
  [/Î³/g, "γ"],
  [/Î´/g, "δ"],
  [/Î¸/g, "θ"],
  [/Î»/g, "λ"],
  [/Ï€/g, "π"],
  [/Ïƒ/g, "σ"],
  [/Â/g, ""],
];

function getMojibakeScore(value: string) {
  const suspiciousMatches = value.match(/[ÃÂâ�]/g);
  return suspiciousMatches ? suspiciousMatches.length : 0;
}

function decodeWindows1252Mojibake(value: string) {
  if (!/[ÃÂâ][\s\S]?/.test(value)) {
    return value;
  }

  const bytes: number[] = [];

  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    const windows1252Byte = WINDOWS_1252_CODE_POINT_TO_BYTE.get(codePoint);

    if (windows1252Byte === undefined) {
      return value;
    }

    bytes.push(windows1252Byte);
  }

  try {
    const decoded = new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    return getMojibakeScore(decoded) < getMojibakeScore(value) ? decoded : value;
  } catch {
    return value;
  }
}

export function repairTextArtifacts(value: string) {
  let nextValue = decodeWindows1252Mojibake(value);

  for (const [pattern, replacement] of TEXT_ARTIFACT_REPLACEMENTS) {
    nextValue = nextValue.replace(pattern, replacement);
  }

  return nextValue
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200f]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function unescapeLiteralLineBreaks(value: string) {
  if (value.includes("\\n") && !value.includes("\n")) {
    return value.replace(/\\n/g, "\n");
  }

  return value;
}

function normalizeMathDelimiters(markdown: string) {
  return markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, equation: string) => {
      return `\n\n$$\n${equation.trim()}\n$$\n\n`;
    })
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, equation: string) => {
      return `$${equation.trim()}$`;
    });
}

function normalizeDisplayMathSpacing(markdown: string) {
  return markdown
    .replace(/\$\$\s*([^\s$])/g, "$$\n$1")
    .replace(/([^\s$])\s*\$\$/g, "$1\n$$")
    .replace(/\$\$\n{2,}/g, "$$\n");
}

function repairDanglingMatrixBlocks(markdown: string) {
  return markdown.replace(
    /(^|\n)(\\frac\{[\s\S]*?\\end\{(?:p|b|v)?matrix\})\s*\$\$/g,
    (_match, prefix: string, matrixBody: string) =>
      `${prefix}\n$$\n\\begin{pmatrix}\n${matrixBody.trim()}\n$$\n`,
  );
}

function isMarkdownTableSeparator(row: string) {
  return /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(row.trim());
}

function restoreInlineMarkdownTables(markdown: string) {
  if (!/\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|/.test(markdown)) {
    return markdown;
  }

  const markdownWithRowBreaks = markdown.replace(/\|\s+\|/g, "|\n|");
  const rowPattern = /\|[^|\n]+(?:\|[^|\n]+)+\|/g;
  const rows = Array.from(markdownWithRowBreaks.matchAll(rowPattern));

  if (rows.length < 2) {
    return markdownWithRowBreaks;
  }

  const replacements: Array<{
    start: number;
    end: number;
    text: string;
  }> = [];

  for (let index = 0; index < rows.length;) {
    const group = [rows[index]];
    let nextIndex = index + 1;

    while (
      nextIndex < rows.length &&
      /^\s*$/.test(
        markdownWithRowBreaks.slice(
          (group[group.length - 1].index ?? 0) + group[group.length - 1][0].length,
          rows[nextIndex].index ?? 0,
        ),
      )
    ) {
      group.push(rows[nextIndex]);
      nextIndex += 1;
    }

    if (group.length >= 2 && isMarkdownTableSeparator(group[1][0])) {
      const start = group[0].index ?? 0;
      const lastRow = group[group.length - 1];
      const end = (lastRow.index ?? 0) + lastRow[0].length;

      replacements.push({
        start,
        end,
        text: `\n\n${group.map((row) => row[0].trim()).join("\n")}\n\n`,
      });
    }

    index = nextIndex;
  }

  if (!replacements.length) {
    return markdown;
  }

  let nextMarkdown = "";
  let cursor = 0;

  for (const replacement of replacements) {
    nextMarkdown += markdownWithRowBreaks.slice(cursor, replacement.start);
    nextMarkdown += replacement.text;
    cursor = replacement.end;
  }

  nextMarkdown += markdownWithRowBreaks.slice(cursor);

  return nextMarkdown
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanMarkdownSpacing(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanInlineText(value: string) {
  return repairTextArtifacts(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function cleanMarkdownText(value: string) {
  return cleanMarkdownSpacing(
    restoreInlineMarkdownTables(
      normalizeDisplayMathSpacing(
        repairDanglingMatrixBlocks(
          normalizeMathDelimiters(repairTextArtifacts(unescapeLiteralLineBreaks(value))),
        ),
      ),
    ),
  );
}

export function cleanQuestionText(value: string) {
  return cleanMarkdownText(value)
    .replace(/[ \t]+/g, " ")
    .replace(/\s+(?=(?:[ivxlcdm]+|[a-h]|\d+)[.)]\s+)/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanFinalAnswerText(value: string) {
  return cleanMarkdownText(value)
    .replace(/^(?:\*\*)?\s*final\s+answer\s*(?:\*\*)?\s*:?\s*/i, "")
    .trim();
}

export function repairSmilesNotation(value: string) {
  return repairTextArtifacts(value)
    .replace(/\s+/g, "")
    .replace(/O=N\(\[O-\]\)/g, "O=[N+]([O-])")
    .replace(/N\(=O\)=O/g, "[N+](=O)[O-]")
    .replace(/N\(=O\)\(\[O-\]\)/g, "[N+](=O)([O-])")
    .trim();
}

export function removeEmbeddedFinalAnswerSection(markdown: string) {
  const cleanedMarkdown = cleanMarkdownText(markdown);
  const strippedMarkdown = cleanedMarkdown
    .replace(
      /(?:^|\n{1,2})(?:#{1,6}\s*)?(?:\*\*)?\s*final\s+answer\s*(?:\*\*)?\s*:?\s*[\s\S]*$/i,
      "",
    )
    .trim();

  if (strippedMarkdown.length >= 80) {
    return strippedMarkdown;
  }

  return cleanedMarkdown;
}

export function formatMarkdownForDisplay(content: string) {
  return cleanMarkdownText(content);
}

export function normalizeExtractedQuestion(
  question: ExtractedQuestion,
  index: number,
): ExtractedQuestion {
  return {
    id: cleanInlineText(question.id) || `q${index + 1}`,
    questionNumber: cleanInlineText(question.questionNumber) || `Q${index + 1}`,
    topic: cleanInlineText(question.topic) || "Unclassified topic",
    marks: cleanInlineText(question.marks) || "Not specified",
    questionText: cleanQuestionText(question.questionText),
  };
}

export function normalizeDraftContent(draft: QuestionPaperDraft): QuestionPaperDraft {
  return {
    ...draft,
    paperTitle: cleanInlineText(draft.paperTitle) || "Question Paper",
    subject: cleanInlineText(draft.subject) || "Question paper",
    overviewMarkdown:
      cleanMarkdownText(draft.overviewMarkdown) ||
      "The paper has been extracted and organized for solving.",
    studyTipsMarkdown:
      cleanMarkdownText(draft.studyTipsMarkdown) ||
      "Revise the key formulas, definitions, and worked examples from this paper.",
    questions: draft.questions.map(normalizeExtractedQuestion),
  };
}

export function normalizeSolutionContent(solution: SolutionItem): SolutionItem {
  const finalAnswer = cleanFinalAnswerText(solution.finalAnswer);

  return {
    ...solution,
    id: cleanInlineText(solution.id),
    questionNumber: cleanInlineText(solution.questionNumber),
    topic: cleanInlineText(solution.topic) || "Unclassified topic",
    marks: cleanInlineText(solution.marks) || "Not specified",
    questionText: cleanQuestionText(solution.questionText),
    answerMarkdown: removeEmbeddedFinalAnswerSection(solution.answerMarkdown),
    finalAnswer: finalAnswer || "Answer not specified.",
    diagramMermaid: "",
    chemicalStructures: (solution.chemicalStructures ?? [])
      .map((structure) => ({
        title: cleanInlineText(structure.title),
        smiles: repairSmilesNotation(structure.smiles),
        caption: cleanInlineText(structure.caption),
      }))
      .filter((structure) => structure.title && structure.smiles)
      .slice(0, 6),
  };
}

export function normalizeQuestionPaperSolutionContent(
  solution: QuestionPaperSolution,
): QuestionPaperSolution {
  return {
    ...solution,
    paperTitle: cleanInlineText(solution.paperTitle) || "Question Paper",
    subject: cleanInlineText(solution.subject) || "Question paper",
    overviewMarkdown:
      cleanMarkdownText(solution.overviewMarkdown) ||
      "The paper has been solved and organized for revision.",
    studyTipsMarkdown:
      cleanMarkdownText(solution.studyTipsMarkdown) ||
      "Review the solved steps and final answers before the exam.",
    solutions: solution.solutions.map(normalizeSolutionContent),
  };
}
