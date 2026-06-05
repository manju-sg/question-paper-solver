import type {
  QuestionPaperDraft,
  QuestionPaperSolution,
  SolveHistoryItem,
  SolveJobSnapshot,
} from "@/lib/solution-schema";
import { cleanInlineText, cleanMarkdownText } from "@/lib/solution-formatting";

function stripMarkdown(markdown: string) {
  return cleanMarkdownText(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/(\*\*|__|\*|_|~~|#+|\|)/g, " ")
    .replace(/\$+[^$]*\$+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeFileName(fileName: string) {
  return cleanInlineText(fileName)
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPaperTitle(
  sourceFileName: string,
  draft: QuestionPaperDraft | null,
  result: QuestionPaperSolution | null,
) {
  return cleanInlineText(
    result?.paperTitle || draft?.paperTitle || humanizeFileName(sourceFileName) || "Question Paper",
  );
}

function getPaperSubject(
  draft: QuestionPaperDraft | null,
  result: QuestionPaperSolution | null,
) {
  return cleanInlineText(result?.subject || draft?.subject || "Question paper workspace");
}

function getPreviewText(snapshot: SolveJobSnapshot) {
  if (snapshot.status === "failed") {
    return cleanInlineText(snapshot.error || snapshot.message);
  }

  if (snapshot.status !== "completed") {
    return cleanInlineText(snapshot.message);
  }

  const completedPreview =
    snapshot.result?.studyTipsMarkdown ||
    snapshot.result?.overviewMarkdown ||
    snapshot.result?.solutions[0]?.finalAnswer ||
    snapshot.draft?.overviewMarkdown ||
    snapshot.message;

  return stripMarkdown(completedPreview).slice(0, 180) || "Solved paper ready to review.";
}

export function createSolveHistoryItem(snapshot: SolveJobSnapshot): SolveHistoryItem {
  return {
    jobId: snapshot.jobId,
    sourceFileName: snapshot.sourceFileName,
    title: getPaperTitle(snapshot.sourceFileName, snapshot.draft, snapshot.result),
    subject: getPaperSubject(snapshot.draft, snapshot.result),
    previewText: getPreviewText(snapshot),
    status: snapshot.status,
    stage: snapshot.stage,
    progress: snapshot.progress,
    totalQuestions: snapshot.totalQuestions,
    solvedQuestions: snapshot.solvedQuestions,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}
