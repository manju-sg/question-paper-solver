import { NextResponse } from "next/server";
import { listSolveHistory } from "@/lib/solve-job-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listSolveHistory(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
