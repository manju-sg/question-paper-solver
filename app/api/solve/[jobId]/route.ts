import { NextResponse } from "next/server";
import { getSolveJob } from "@/lib/solve-job-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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

  return NextResponse.json(job, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
