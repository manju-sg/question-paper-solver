import { NextResponse } from "next/server";
import { continueQuestionPaperSolving } from "@/lib/gemini";
import { readSolvePdfBlob } from "@/lib/solve-file-store";
import {
  applySolveProgress,
  completeSolveJob,
  failSolveJob,
  getSolveJob,
} from "@/lib/solve-job-store";

export const runtime = "nodejs";

function sanitizeDisplayName(fileName: string) {
  return fileName.replace(/[^\w.-]+/g, "-");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getSolveJob(jobId);

  if (!job) {
    return NextResponse.json(
      { error: "Solve job not found or expired." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (job.status === "running" || job.status === "queued") {
    return NextResponse.json(
      { error: "This paper is already being solved. Wait for the current run to finish." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!job.draft) {
    return NextResponse.json(
      { error: "This paper has no extracted questions to continue from." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    notes?: unknown;
    questionId?: unknown;
  };
  const questionId =
    typeof body.questionId === "string" ? body.questionId.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const targetQuestion = questionId
    ? job.draft.questions.find((question) => question.id === questionId)
    : null;

  if (questionId && !targetQuestion) {
    return NextResponse.json(
      { error: "The selected question was not found in this paper." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const currentSolutions = job.result?.solutions ?? job.partialSolutions;
  const retainedSolutions = questionId
    ? currentSolutions.filter((solution) => solution.id !== questionId)
    : currentSolutions;
  const pdfBlob = readSolvePdfBlob(job.jobId) ?? undefined;

  applySolveProgress(job.jobId, {
    stage: "solving",
    progress: Math.max(12, Math.min(job.progress, 92)),
    message: targetQuestion
      ? `Queued regeneration for ${targetQuestion.questionNumber}.`
      : "Queued continuation from the extracted questions.",
    draft: job.draft,
    partialSolutions: retainedSolutions,
    totalQuestions: job.draft.questions.length,
    solvedQuestions: retainedSolutions.length,
    meta: job.meta ?? undefined,
  });

  void (async () => {
    try {
      const outcome = await continueQuestionPaperSolving({
        fileBlob: pdfBlob,
        fileName: sanitizeDisplayName(job.sourceFileName),
        notes,
        draft: job.draft!,
        partialSolutions: retainedSolutions,
        targetQuestionIds: questionId ? [questionId] : undefined,
        onProgress: (update) => applySolveProgress(job.jobId, update),
      });

      completeSolveJob(job.jobId, {
        draft: outcome.draft,
        result: outcome.result,
        meta: {
          model: outcome.model,
          usedKeyIndex: outcome.usedKeyIndex,
        },
      });
    } catch (error) {
      failSolveJob(
        job.jobId,
        error instanceof Error
          ? error.message
          : "Something went wrong while retrying the extracted questions.",
      );
    }
  })();

  return NextResponse.json(
    { jobId: job.jobId },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
