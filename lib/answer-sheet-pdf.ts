import type { SolveJobSnapshot, SolutionItem } from "@/lib/solution-schema";
import { formatMarkdownForDisplay } from "@/lib/solution-formatting";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const MARGIN_BOTTOM = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

type PdfLine = {
  font: "regular" | "bold";
  size: number;
  text: string;
};

type PdfPage = PdfLine[];

function normalizePdfText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownToPlainText(markdown: string) {
  return normalizePdfText(formatMarkdownForDisplay(markdown))
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?|\n?```$/g, ""),
    )
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, math: string) => `\n${math.trim()}\n`)
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\\begin\{aligned\}|\\end\{aligned\}/g, "")
    .replace(/\\begin\{(?:p|b|v)?matrix\}/g, "[")
    .replace(/\\end\{(?:p|b|v)?matrix\}/g, "]")
    .replace(/\\\\/g, "\n")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\partial/g, "∂")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\vdots/g, "⋮")
    .replace(/\\ldots|\\dots/g, "…")
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function estimateMaxCharacters(fontSize: number) {
  return Math.max(32, Math.floor(CONTENT_WIDTH / (fontSize * 0.52)));
}

function wrapLine(line: string, fontSize: number) {
  const maxCharacters = estimateMaxCharacters(fontSize);
  const words = line.split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (word.length > maxCharacters) {
      if (currentLine) {
        wrapped.push(currentLine);
        currentLine = "";
      }

      for (let index = 0; index < word.length; index += maxCharacters) {
        wrapped.push(word.slice(index, index + maxCharacters));
      }

      continue;
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length > maxCharacters && currentLine) {
      wrapped.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }

  if (currentLine) {
    wrapped.push(currentLine);
  }

  return wrapped.length ? wrapped : [""];
}

function wrapParagraph(text: string, fontSize: number) {
  return text
    .split("\n")
    .flatMap((line) => wrapLine(line.trim(), fontSize));
}

function escapePdfName(value: string) {
  return value.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").trim();
}

function textToUtf16Hex(value: string) {
  const bytes = [0xfe, 0xff];

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0x20;

    if (codePoint > 0xffff) {
      const adjustedCodePoint = codePoint - 0x10000;
      const highSurrogate = 0xd800 + (adjustedCodePoint >> 10);
      const lowSurrogate = 0xdc00 + (adjustedCodePoint & 0x3ff);
      bytes.push(highSurrogate >> 8, highSurrogate & 0xff);
      bytes.push(lowSurrogate >> 8, lowSurrogate & 0xff);
    } else {
      bytes.push(codePoint >> 8, codePoint & 0xff);
    }
  }

  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createPageBuilder() {
  const pages: PdfPage[] = [[]];
  let cursorY = PAGE_HEIGHT - 52;

  function currentPage() {
    return pages[pages.length - 1];
  }

  function addPage() {
    pages.push([]);
    cursorY = PAGE_HEIGHT - 52;
  }

  function ensureSpace(lineHeight: number) {
    if (cursorY - lineHeight < MARGIN_BOTTOM) {
      addPage();
    }
  }

  function addLine(text: string, options?: Partial<Omit<PdfLine, "text">>) {
    const line: PdfLine = {
      font: options?.font ?? "regular",
      size: options?.size ?? 10,
      text,
    };
    const lineHeight = line.size * 1.36;

    ensureSpace(lineHeight);
    currentPage().push(line);
    cursorY -= lineHeight;
  }

  function addParagraph(text: string, options?: Partial<Omit<PdfLine, "text">>) {
    const fontSize = options?.size ?? 10;
    const paragraphs = normalizePdfText(text).split(/\n{2,}/);

    for (const paragraph of paragraphs) {
      for (const line of wrapParagraph(paragraph, fontSize)) {
        addLine(line, options);
      }

      cursorY -= fontSize * 0.45;
    }
  }

  function addGap(size = 8) {
    cursorY -= size;
  }

  return {
    addGap,
    addLine,
    addPage,
    addParagraph,
    getPages: () => pages,
  };
}

function getSolutions(job: SolveJobSnapshot): SolutionItem[] {
  return job.result?.solutions ?? job.partialSolutions;
}

function addSolution(
  builder: ReturnType<typeof createPageBuilder>,
  solution: SolutionItem,
) {
  builder.addGap(8);
  builder.addLine(`${solution.questionNumber}. ${solution.topic}`, {
    font: "bold",
    size: 13,
  });
  builder.addLine(`Marks: ${solution.marks} | Confidence: ${solution.confidence}`, {
    size: 8.5,
  });
  builder.addGap(3);
  builder.addLine("Question", { font: "bold", size: 10.5 });
  builder.addParagraph(markdownToPlainText(solution.questionText), { size: 9.5 });
  builder.addLine("Worked Solution", { font: "bold", size: 10.5 });
  builder.addParagraph(markdownToPlainText(solution.answerMarkdown), { size: 9.5 });
  builder.addLine("Final Answer", { font: "bold", size: 10.5 });
  builder.addParagraph(markdownToPlainText(solution.finalAnswer), {
    font: "bold",
    size: 9.5,
  });
}

function createContentStream(page: PdfPage, pageNumber: number, pageCount: number) {
  let cursorY = PAGE_HEIGHT - 52;
  const commands: string[] = [
    "0.98 0.99 1 rg",
    `0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)} re f`,
    "0.18 0.31 0.52 RG",
    "0.7 w",
    `${MARGIN_X} ${PAGE_HEIGHT - 35} ${CONTENT_WIDTH} 0 re S`,
  ];

  for (const line of page) {
    const lineHeight = line.size * 1.36;
    const fontName = line.font === "bold" ? "F2" : "F1";
    commands.push("BT");
    commands.push(`/${fontName} ${line.size.toFixed(2)} Tf`);
    commands.push("0.08 0.16 0.28 rg");
    commands.push(`${MARGIN_X.toFixed(2)} ${cursorY.toFixed(2)} Td`);
    commands.push(`<${textToUtf16Hex(line.text)}> Tj`);
    commands.push("ET");
    cursorY -= lineHeight;
  }

  commands.push("BT");
  commands.push("/F1 8 Tf");
  commands.push("0.35 0.43 0.55 rg");
  commands.push(`${MARGIN_X.toFixed(2)} 24 Td`);
  commands.push(`<${textToUtf16Hex(`Page ${pageNumber} of ${pageCount}`)}> Tj`);
  commands.push("ET");

  return commands.join("\n");
}

function createPdfBuffer(pages: PdfPage[]) {
  const objects: string[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const regularFontId = 3;
  const boldFontId = 4;
  const pageIds = pages.map((_page, index) => 5 + index * 2);
  const contentIds = pages.map((_page, index) => 6 + index * 2);

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pages.length} >>`;
  objects[regularFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[boldFontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = contentIds[index];
    const stream = createContentStream(page, index + 1, pages.length);

    objects[pageId] = [
      "<<",
      "/Type /Page",
      `/Parent ${pagesId} 0 R`,
      `/MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}]`,
      `/Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >>`,
      `/Contents ${contentId} 0 R`,
      ">>",
    ].join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
  });

  const parts = ["%PDF-1.7\n%âãÏÓ\n"];
  const offsets = [0];

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(parts.join(""), "utf8");
    parts.push(`${index} 0 obj\n${objects[index]}\nendobj\n`);
  }

  const xrefOffset = Buffer.byteLength(parts.join(""), "utf8");
  parts.push(`xref\n0 ${objects.length}\n`);
  parts.push("0000000000 65535 f \n");

  for (let index = 1; index < objects.length; index += 1) {
    parts.push(`${offsets[index].toString().padStart(10, "0")} 00000 n \n`);
  }

  parts.push(
    `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Buffer.from(parts.join(""), "utf8");
}

export function createAnswerSheetPdf(job: SolveJobSnapshot) {
  const builder = createPageBuilder();
  const title = job.result?.paperTitle ?? job.draft?.paperTitle ?? "Question Paper";
  const subject = job.result?.subject ?? job.draft?.subject ?? "Solved Answer Sheet";
  const overview =
    job.result?.overviewMarkdown ??
    job.draft?.overviewMarkdown ??
    "Solved answer sheet generated by Question Paper Solver.";
  const studyTips =
    job.result?.studyTipsMarkdown ??
    job.draft?.studyTipsMarkdown ??
    "Review the worked solutions and final answers.";

  builder.addLine(title, { font: "bold", size: 18 });
  builder.addLine(subject, { size: 11 });
  builder.addLine(`Source: ${job.sourceFileName}`, { size: 8.5 });
  builder.addGap(8);
  builder.addLine("Paper Overview", { font: "bold", size: 12 });
  builder.addParagraph(markdownToPlainText(overview), { size: 9.5 });
  builder.addLine("Study Tips", { font: "bold", size: 12 });
  builder.addParagraph(markdownToPlainText(studyTips), { size: 9.5 });

  for (const solution of getSolutions(job)) {
    addSolution(builder, solution);
  }

  return {
    fileName: `${escapePdfName(title) || "question-paper-solutions"}.pdf`,
    pdf: createPdfBuffer(builder.getPages()),
  };
}
