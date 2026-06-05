import { NextResponse } from "next/server";
import { createAnswerSheetPdf } from "@/lib/answer-sheet-pdf";
import { getSolveJob } from "@/lib/solve-job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = getSolveJob(jobId);

    if (!job || (!job.draft && !job.result)) {
      return NextResponse.json(
        { error: "Solved paper not found or expired." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { fileName, pdf } = createAnswerSheetPdf(job);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": `${pdf.byteLength}`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create the PDF download.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
