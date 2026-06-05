import { NextResponse } from "next/server";
import { solveQuestionPaperProgressively } from "@/lib/gemini";
import {
  applySolveProgress,
  completeSolveJob,
  createSolveJob,
  failSolveJob,
} from "@/lib/solve-job-store";
import { saveSolvePdf } from "@/lib/solve-file-store";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const runtime = "nodejs";

function sanitizeDisplayName(fileName: string) {
  return fileName.replace(/[^\w.-]+/g, "-");
}

function hasPdfMarkers(arrayBuffer: ArrayBuffer) {
  if (arrayBuffer.byteLength < 5) {
    return false;
  }

  const header = Buffer.from(arrayBuffer, 0, 5).toString("ascii");
  const tailLength = Math.min(16 * 1024, arrayBuffer.byteLength);
  const tailStart = arrayBuffer.byteLength - tailLength;
  const tail = Buffer.from(arrayBuffer, tailStart, tailLength).toString("ascii");

  return header === "%PDF-" && tail.includes("%%EOF");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("questionPaper");
    const notes = formData.get("notes");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Upload a PDF question paper before solving." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      return NextResponse.json(
        { error: "Only PDF question papers are supported right now." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "The PDF is larger than the 50 MB Gemini upload limit." },
        { status: 413, headers: { "Cache-Control": "no-store" } },
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    if (!hasPdfMarkers(arrayBuffer)) {
      return NextResponse.json(
        {
          error:
            "The selected file does not look like a complete readable PDF. If it is still downloading, wait for it to finish; otherwise re-save/export it as PDF and upload again.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const pdfBlob = new Blob([arrayBuffer], { type: "application/pdf" });
    const job = createSolveJob(file.name);
    saveSolvePdf(job.jobId, arrayBuffer);
    const jobNotes = typeof notes === "string" ? notes.trim() : "";

    void (async () => {
      try {
        const outcome = await solveQuestionPaperProgressively({
          fileBlob: pdfBlob,
          fileName: sanitizeDisplayName(file.name),
          notes: jobNotes,
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
            : "Something went wrong while solving the question paper.",
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
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while preparing the solve job.";

    return NextResponse.json(
      { error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
