import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOLVE_FILE_DIR = join(process.cwd(), "data", "solve-files");

function ensureSolveFileDir() {
  mkdirSync(SOLVE_FILE_DIR, { recursive: true });
}

function getSolveFilePath(jobId: string) {
  return join(SOLVE_FILE_DIR, `${jobId}.pdf`);
}

export function saveSolvePdf(jobId: string, arrayBuffer: ArrayBuffer) {
  ensureSolveFileDir();
  writeFileSync(getSolveFilePath(jobId), Buffer.from(arrayBuffer));
}

export function readSolvePdfBlob(jobId: string) {
  const filePath = getSolveFilePath(jobId);

  if (!existsSync(filePath)) {
    return null;
  }

  return new Blob([readFileSync(filePath)], { type: "application/pdf" });
}
