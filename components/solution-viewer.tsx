"use client";

import "katex/contrib/mhchem";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { ChemicalStructureGallery } from "@/components/chemical-structure-gallery";
import { formatMarkdownForDisplay } from "@/lib/solution-formatting";
import type {
  ExtractedQuestion,
  QuestionPaperDraft,
  QuestionPaperSolution,
  SolveJobStage,
  SolveJobStatus,
  SolverMeta,
  SolutionItem,
} from "@/lib/solution-schema";

type ViewerProps = {
  draft: QuestionPaperDraft | null;
  jobId?: string;
  isPrintView?: boolean;
  result: QuestionPaperSolution | null;
  partialSolutions: SolutionItem[];
  meta: SolverMeta | null;
  progress: number;
  message: string;
  sourceFileName?: string;
  stage: SolveJobStage;
  status: SolveJobStatus;
  onRetryQuestion?: (questionId: string, questionLabel: string) => void;
  retryingQuestionId?: string | null;
};

const markdownComponents: Components = {
  table({ children, ...props }) {
    return (
      <div className="markdown-table-wrap">
        <table {...props}>{children}</table>
      </div>
    );
  },
  a({ children, ...props }) {
    return (
      <a rel="noreferrer" target="_blank" {...props}>
        {children}
      </a>
    );
  },
};

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="markdown-block">
      <ReactMarkdown
        components={markdownComponents}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {formatMarkdownForDisplay(content)}
      </ReactMarkdown>
    </div>
  );
}

function buildQuestionList(
  draft: QuestionPaperDraft | null,
  result: QuestionPaperSolution | null,
): ExtractedQuestion[] {
  if (draft) {
    return draft.questions;
  }

  if (!result) {
    return [];
  }

  return result.solutions.map((solution) => ({
    id: solution.id,
    questionNumber: solution.questionNumber,
    topic: solution.topic,
    marks: solution.marks,
    questionText: solution.questionText,
  }));
}

export function SolutionViewer({
  draft,
  jobId,
  isPrintView = false,
  result,
  partialSolutions,
  meta,
  progress,
  message,
  sourceFileName,
  stage,
  status,
  onRetryQuestion,
  retryingQuestionId,
}: ViewerProps) {
  const questions = buildQuestionList(draft, result);
  const solutionMap = new Map(
    (result?.solutions ?? partialSolutions).map((solution) => [solution.id, solution]),
  );
  const solvedCount = result?.solutions.length ?? partialSolutions.length;
  const paperTitle = result?.paperTitle ?? draft?.paperTitle ?? "Question Paper";
  const subject = result?.subject ?? draft?.subject ?? "Subject loading...";
  const overviewMarkdown =
    result?.overviewMarkdown ??
    draft?.overviewMarkdown ??
    "The solver is still reading the paper and organizing its structure.";
  const studyTipsMarkdown =
    result?.studyTipsMarkdown ??
    draft?.studyTipsMarkdown ??
    "Study tips will appear after the paper structure has been extracted.";
  const confidenceSummary =
    result?.solutions.reduce(
      (summary, solution) => ({
        ...summary,
        [solution.confidence]: summary[solution.confidence] + 1,
      }),
      { high: 0, medium: 0, low: 0 },
    ) ?? null;

  return (
    <section className={`result-panel ${status !== "completed" ? "result-panel-live" : ""}`}>
      <div className="result-header">
        <div>
          <h2 className="result-title">{paperTitle}</h2>
          <p className="result-subtitle">{subject}</p>
        </div>
        <div className="result-header-side">
          <div className="meta-row">
            {sourceFileName ? <span className="meta-pill">{sourceFileName}</span> : null}
            {meta ? <span className="meta-pill">{meta.model}</span> : null}
            {meta ? (
              <span className="meta-pill">API key slot #{meta.usedKeyIndex}</span>
            ) : null}
            <span className="meta-pill">
              {solvedCount} of {questions.length || "?"} answers ready
            </span>
            {confidenceSummary ? (
              <span className="meta-pill">
                {confidenceSummary.high} high-confidence
              </span>
            ) : null}
            {isPrintView ? <span className="meta-pill">Print-ready answer sheet</span> : null}
          </div>

          {jobId && status === "completed" && !isPrintView ? (
            <div className="result-actions no-print">
              <a
                className="export-button"
                href={`/api/solve/${jobId}/pdf`}
              >
                Download PDF
              </a>
              <a
                className="export-secondary-button"
                href={`/print/${jobId}`}
                rel="noreferrer"
                target="_blank"
              >
                Open print view
              </a>
            </div>
          ) : null}
        </div>
      </div>

      {status !== "completed" ? (
        <div className="live-banner">
          <div className="live-banner-copy">
            <strong>
              {stage === "extracting"
                ? "Questions are being extracted from the PDF"
                : "Solutions are being generated live"}
            </strong>
            <p>{message}</p>
          </div>
          <div className="live-banner-meter">
            <span>{Math.round(progress)}%</span>
          </div>
        </div>
      ) : null}

      <div className="overview-card">
        <article className="overview-section">
          <h2>Paper Overview</h2>
          <MarkdownBlock content={overviewMarkdown} />
        </article>

        <article className="tips-section">
          <h2>Study Tips</h2>
          <MarkdownBlock content={studyTipsMarkdown} />
        </article>
      </div>

      <div className="solutions-grid">
        {questions.map((question) => {
          const solution = solutionMap.get(question.id);
          const isRetryingThisQuestion = retryingQuestionId === question.id;
          const canRetryQuestion =
            Boolean(onRetryQuestion) &&
            !isPrintView &&
            status !== "queued" &&
            status !== "running";

          return (
            <article
              className={`solution-card ${solution ? "" : "solution-card-pending"}`}
              key={question.id}
            >
              <div className="solution-topline">
                <div className="solution-labels">
                  <span className="question-chip">{question.questionNumber}</span>
                  <span className="meta-pill">{question.topic}</span>
                  <span className="meta-pill">{question.marks}</span>
                </div>

                <div className="solution-status-actions">
                  <span className="confidence-pill">
                    {solution ? `Confidence: ${solution.confidence}` : "Queued for solving"}
                  </span>
                  {canRetryQuestion ? (
                    <button
                      className="retry-question-button"
                      disabled={isRetryingThisQuestion}
                      onClick={() =>
                        onRetryQuestion?.(question.id, question.questionNumber)
                      }
                      type="button"
                    >
                      {isRetryingThisQuestion
                        ? "Regenerating..."
                        : solution
                          ? "Regenerate answer"
                          : "Retry answer"}
                    </button>
                  ) : null}
                </div>
              </div>

              <h3>{question.topic}</h3>
              <div className="question-text">
                <div className="section-eyebrow">Question</div>
                <MarkdownBlock content={question.questionText} />
              </div>

              {solution ? (
                <>
                  <div className="solution-body">
                    <div className="section-eyebrow">Worked Solution</div>
                    <MarkdownBlock content={solution.answerMarkdown} />
                  </div>
                  <ChemicalStructureGallery structures={solution.chemicalStructures} />

                  <div className="final-answer">
                    <strong>Final Answer</strong>
                    <MarkdownBlock content={solution.finalAnswer} />
                  </div>
                </>
              ) : (
                <div className="pending-solution">
                  <div className="pending-badge">AI is still solving this question</div>
                  <p className="pending-text">
                    The paper has already been parsed, so this answer will appear
                    automatically as soon as its batch completes.
                  </p>
                  <div className="pending-lines">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
