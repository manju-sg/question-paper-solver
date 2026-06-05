import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  QuestionPaperDraft,
  QuestionPaperSolution,
  SolveHistoryItem,
  SolveJobSnapshot,
  SolverMeta,
  SolutionItem,
} from "@/lib/solution-schema";
import { solveJobSnapshotSchema } from "@/lib/solution-schema";
import { createSolveHistoryItem } from "@/lib/solve-history";
import type { SolveProgressUpdate } from "@/lib/gemini";
import {
  cleanInlineText,
  normalizeDraftContent,
  normalizeQuestionPaperSolutionContent,
  normalizeSolutionContent,
} from "@/lib/solution-formatting";

const jobs = new Map<string, SolveJobSnapshot>();
const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "solve-history.json");
const MAX_STORED_JOBS = 60;
const INTERRUPTED_JOB_MESSAGE =
  "This solve was interrupted before it could finish. Upload the paper again to continue.";

let didLoadPersistedJobs = false;

function nowIso() {
  return new Date().toISOString();
}

function ensureStorageDir() {
  mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeJobSnapshotContent(snapshot: SolveJobSnapshot): SolveJobSnapshot {
  return solveJobSnapshotSchema.parse({
    ...snapshot,
    sourceFileName: cleanInlineText(snapshot.sourceFileName),
    message: cleanInlineText(snapshot.message),
    draft: snapshot.draft ? normalizeDraftContent(snapshot.draft) : null,
    partialSolutions: snapshot.partialSolutions.map(normalizeSolutionContent),
    result: snapshot.result
      ? normalizeQuestionPaperSolutionContent(snapshot.result)
      : null,
    error: snapshot.error ? cleanInlineText(snapshot.error) : null,
  });
}

function normalizeLoadedJob(snapshot: unknown) {
  const parsed = solveJobSnapshotSchema.safeParse(snapshot);

  if (!parsed.success) {
    return null;
  }

  const job = normalizeJobSnapshotContent(parsed.data);

  if (job.status === "queued" || job.status === "running") {
    return {
      ...job,
      status: "failed" as const,
      stage: "failed" as const,
      message: INTERRUPTED_JOB_MESSAGE,
      error: INTERRUPTED_JOB_MESSAGE,
      updatedAt: nowIso(),
    };
  }

  return job;
}

function sortJobsByRecent(left: SolveJobSnapshot, right: SolveJobSnapshot) {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function trimJobs() {
  const sorted = Array.from(jobs.values()).sort(sortJobsByRecent);

  for (const snapshot of sorted.slice(MAX_STORED_JOBS)) {
    jobs.delete(snapshot.jobId);
  }
}

function persistJobs() {
  ensureStorageDir();
  trimJobs();

  const payload = {
    jobs: Array.from(jobs.values()).sort(sortJobsByRecent),
  };

  writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), "utf8");
}

function loadPersistedJobs() {
  if (didLoadPersistedJobs) {
    return;
  }

  didLoadPersistedJobs = true;

  if (!existsSync(DATA_FILE)) {
    ensureStorageDir();
    return;
  }

  try {
    const raw = readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as { jobs?: unknown[] };

    for (const snapshot of parsed.jobs ?? []) {
      const normalized = normalizeLoadedJob(snapshot);

      if (normalized) {
        jobs.set(normalized.jobId, normalized);
      }
    }

    persistJobs();
  } catch {
    jobs.clear();
  }
}

function upsertJob(snapshot: SolveJobSnapshot) {
  loadPersistedJobs();
  const normalizedSnapshot = normalizeJobSnapshotContent(snapshot);

  jobs.set(normalizedSnapshot.jobId, normalizedSnapshot);
  persistJobs();
  return normalizedSnapshot;
}

export function createSolveJob(sourceFileName: string) {
  loadPersistedJobs();

  const timestamp = nowIso();
  const jobId = crypto.randomUUID();
  const snapshot: SolveJobSnapshot = {
    jobId,
    sourceFileName,
    status: "queued",
    stage: "queued",
    progress: 0,
    message: "Queued the question paper for processing.",
    totalQuestions: null,
    solvedQuestions: 0,
    draft: null,
    partialSolutions: [],
    result: null,
    meta: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return upsertJob(snapshot);
}

export function applySolveProgress(jobId: string, update: SolveProgressUpdate) {
  loadPersistedJobs();

  const current = jobs.get(jobId);

  if (!current) {
    return;
  }

  const nextPartialSolutions = update.partialSolutions ?? current.partialSolutions;

  upsertJob({
    ...current,
    status:
      update.stage === "completed"
        ? "completed"
        : update.stage === "failed"
          ? "failed"
          : "running",
    stage: update.stage,
    progress: Math.max(0, Math.min(100, Math.round(update.progress))),
    message: update.message,
    totalQuestions:
      update.totalQuestions ?? update.draft?.questions.length ?? current.totalQuestions,
    solvedQuestions:
      update.solvedQuestions ?? update.partialSolutions?.length ?? current.solvedQuestions,
    draft: update.draft ?? current.draft,
    partialSolutions: nextPartialSolutions,
    result: update.partialSolutions ? null : current.result,
    meta: update.meta ?? current.meta,
    error: update.stage === "failed" ? update.message : null,
    updatedAt: nowIso(),
  });
}

export function completeSolveJob(
  jobId: string,
  payload: {
    draft: QuestionPaperDraft;
    result: QuestionPaperSolution;
    meta: SolverMeta;
  },
) {
  loadPersistedJobs();

  const current = jobs.get(jobId);

  if (!current) {
    return;
  }

  upsertJob({
    ...current,
    status: "completed",
    stage: "completed",
    progress: 100,
    message: "Everything is ready. Scroll through the solved paper below.",
    totalQuestions: payload.draft.questions.length,
    solvedQuestions: payload.result.solutions.length,
    draft: payload.draft,
    partialSolutions: payload.result.solutions,
    result: payload.result,
    meta: payload.meta,
    error: null,
    updatedAt: nowIso(),
  });
}

export function failSolveJob(jobId: string, message: string) {
  loadPersistedJobs();

  const current = jobs.get(jobId);

  if (!current) {
    return;
  }

  upsertJob({
    ...current,
    status: "failed",
    stage: "failed",
    progress: current.progress,
    message,
    error: message,
    updatedAt: nowIso(),
  });
}

export function getSolveJob(jobId: string) {
  loadPersistedJobs();
  const current = jobs.get(jobId);
  return current ? normalizeJobSnapshotContent(current) : null;
}

export function listSolveHistory(): SolveHistoryItem[] {
  loadPersistedJobs();

  return Array.from(jobs.values())
    .sort(sortJobsByRecent)
    .map((snapshot) => createSolveHistoryItem(normalizeJobSnapshotContent(snapshot)));
}

export function seedSolveJob(
  jobId: string,
  payload: {
    draft?: QuestionPaperDraft | null;
    partialSolutions?: SolutionItem[];
  },
) {
  loadPersistedJobs();

  const current = jobs.get(jobId);

  if (!current) {
    return;
  }

  upsertJob({
    ...current,
    draft: payload.draft ?? current.draft,
    partialSolutions: payload.partialSolutions ?? current.partialSolutions,
    updatedAt: nowIso(),
  });
}
