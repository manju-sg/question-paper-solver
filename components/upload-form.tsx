"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createSolveHistoryItem } from "@/lib/solve-history";
import {
  solveHistoryListSchema,
  solveJobSnapshotSchema,
  type SolveHistoryItem,
  type SolveJobSnapshot,
} from "@/lib/solution-schema";
import { HistorySidebar } from "./history-sidebar";
import { SolutionViewer } from "./solution-viewer";

type CreateJobResponse = {
  jobId: string;
  error?: string;
};

type ApiErrorPayload = {
  error?: string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const POLL_INTERVAL_MS = 1800;
const RETRYING_PAPER_ID = "__paper_retry__";
const SOLVER_STAGES = [
  "queued",
  "uploading",
  "extracting",
  "solving",
  "finalizing",
] as const;

function nowIso() {
  return new Date().toISOString();
}

function getStageLabel(snapshot: SolveJobSnapshot | null) {
  if (!snapshot) {
    return "Ready for your next PDF";
  }

  switch (snapshot.stage) {
    case "queued":
      return "Queued for solving";
    case "uploading":
      return "Preparing the PDF";
    case "extracting":
      return "Reading the questions";
    case "solving":
      return "Writing the solutions";
    case "finalizing":
      return "Formatting the answer sheet";
    case "completed":
      return "Solved and ready";
    case "failed":
      return "Solve failed";
    default:
      return "Working";
  }
}

function sortHistoryItems(items: SolveHistoryItem[]) {
  return [...items].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}

function upsertHistoryItem(
  items: SolveHistoryItem[],
  nextItem: SolveHistoryItem,
) {
  const nextItems = new Map(items.map((item) => [item.jobId, item]));
  nextItems.set(nextItem.jobId, nextItem);
  return sortHistoryItems(Array.from(nextItems.values()));
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string) {
  const responseText = await response.text();
  let payload: unknown = {};

  if (responseText.trim()) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(
        `${fallbackMessage} Server returned a non-JSON response (${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    const apiError = payload as ApiErrorPayload;
    throw new Error(apiError.error ?? `${fallbackMessage} (${response.status})`);
  }

  return payload as T;
}

async function hasReadablePdfMarkers(file: File) {
  try {
    const header = await file.slice(0, 5).text();
    const tailStart = Math.max(0, file.size - 16 * 1024);
    const tail = await file.slice(tailStart, file.size).text();

    return header === "%PDF-" && tail.includes("%%EOF");
  } catch {
    return true;
  }
}

function createTransientJobSnapshot(fileName: string, message: string): SolveJobSnapshot {
  const timestamp = nowIso();

  return {
    jobId: `local-${timestamp}`,
    sourceFileName: fileName,
    status: "running",
    stage: "queued",
    progress: 2,
    message,
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
}

function markSnapshotAsFailed(
  snapshot: SolveJobSnapshot,
  message: string,
): SolveJobSnapshot {
  return {
    ...snapshot,
    status: "failed",
    stage: "failed",
    progress: snapshot.progress > 0 ? snapshot.progress : 1,
    message,
    error: message,
    updatedAt: nowIso(),
  };
}

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState(
    "Show complete step-by-step derivations, use neat tables where helpful, repair OCR symbols, and keep the answer sheet clean enough for revision notes.",
  );
  const [error, setError] = useState("");
  const [displayedJob, setDisplayedJob] = useState<SolveJobSnapshot | null>(null);
  const [transientJob, setTransientJob] = useState<SolveJobSnapshot | null>(null);
  const [displayedJobId, setDisplayedJobId] = useState<string | null>(null);
  const [pollJobId, setPollJobId] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<SolveHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isLoadingPaper, setIsLoadingPaper] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [retryingQuestionId, setRetryingQuestionId] = useState<string | null>(
    null,
  );
  const hasAutoSelectedHistory = useRef(false);

  const activeJob = transientJob ?? displayedJob;
  const liveJobSummary = pollJobId
    ? historyItems.find((item) => item.jobId === pollJobId) ?? null
    : null;
  const isBusy = isStartingJob || Boolean(pollJobId);
  const canContinueExtractedQuestions = Boolean(
    displayedJob?.draft &&
      displayedJob.status === "failed" &&
      !displayedJob.jobId.startsWith("local-"),
  );
  const isRetryingWholePaper = retryingQuestionId === RETRYING_PAPER_ID;

  async function refreshHistory() {
    const response = await fetch("/api/solve/history", {
      cache: "no-store",
    });

        const payload = await readJsonResponse<unknown>(
          response,
          "Could not read saved paper history.",
        );

        const parsed = solveHistoryListSchema.parse(payload);
    setHistoryItems(parsed);
    return parsed;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const items = await refreshHistory();

        if (cancelled) {
          return;
        }

        if (!hasAutoSelectedHistory.current && items[0]) {
          hasAutoSelectedHistory.current = true;
          setDisplayedJobId(items[0].jobId);

          if (items[0].status === "queued" || items[0].status === "running") {
            setPollJobId(items[0].jobId);
          }
        }
      } catch (historyError) {
        if (cancelled) {
          return;
        }

        setError(
          historyError instanceof Error
            ? historyError.message
            : "Could not load saved papers.",
        );
      } finally {
        if (!cancelled) {
          setIsHistoryLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!displayedJobId) {
      setDisplayedJob(null);
      setIsLoadingPaper(false);
      return;
    }

    if (displayedJob?.jobId === displayedJobId) {
      return;
    }

    let cancelled = false;

    async function loadSelectedJob() {
      try {
        setIsLoadingPaper(true);

        const response = await fetch(`/api/solve/${displayedJobId}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<unknown>(
          response,
          "Could not open the selected paper.",
        );

        const snapshot = solveJobSnapshotSchema.parse(payload);

        if (cancelled) {
          return;
        }

        setDisplayedJob(snapshot);
        setHistoryItems((current) =>
          upsertHistoryItem(current, createSolveHistoryItem(snapshot)),
        );

        if (snapshot.status === "queued" || snapshot.status === "running") {
          setPollJobId(snapshot.jobId);
        }
      } catch (selectedJobError) {
        if (cancelled) {
          return;
        }

        setError(
          selectedJobError instanceof Error
            ? selectedJobError.message
            : "Could not load the selected paper.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingPaper(false);
        }
      }
    }

    void loadSelectedJob();

    return () => {
      cancelled = true;
    };
  }, [displayedJob, displayedJobId]);

  useEffect(() => {
    if (!pollJobId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pollJob() {
      try {
        const response = await fetch(`/api/solve/${pollJobId}`, {
          cache: "no-store",
        });
        const payload = await readJsonResponse<unknown>(
          response,
          "Could not read the live solve status.",
        );

        const snapshot = solveJobSnapshotSchema.parse(payload);

        if (cancelled) {
          return;
        }

        setHistoryItems((current) =>
          upsertHistoryItem(current, createSolveHistoryItem(snapshot)),
        );

        if (!displayedJobId || displayedJobId === snapshot.jobId) {
          setDisplayedJob(snapshot);
          setDisplayedJobId(snapshot.jobId);
        }

        if (snapshot.status === "completed" || snapshot.status === "failed") {
          if (snapshot.status === "failed") {
            setError(snapshot.error ?? snapshot.message);
          }

          setRetryingQuestionId(null);
          setPollJobId((current) => (current === snapshot.jobId ? null : current));
          void refreshHistory();
          return;
        }

        timer = setTimeout(pollJob, POLL_INTERVAL_MS);
      } catch (pollError) {
        if (cancelled) {
          return;
        }

        const message =
          pollError instanceof Error
            ? pollError.message
            : "The solver lost track of the live progress.";

        setDisplayedJob((current) =>
          current && current.jobId === pollJobId
            ? markSnapshotAsFailed(current, message)
            : current,
        );
        setError(
          message,
        );
        setRetryingQuestionId(null);
        setPollJobId(null);
      }
    }

    void pollJob();

    return () => {
      cancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [displayedJobId, pollJobId]);

  async function updateFile(nextFile: File | null) {
    if (!nextFile) {
      return;
    }

    const isPdf =
      nextFile.type === "application/pdf" ||
      nextFile.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setError("Please choose a PDF question paper.");
      return;
    }

    if (nextFile.size > MAX_FILE_BYTES) {
      setError("Please choose a PDF smaller than 50 MB.");
      return;
    }

    if (!(await hasReadablePdfMarkers(nextFile))) {
      setError(
        "This PDF looks incomplete. If it is still downloading, wait until it finishes; otherwise re-save/export it as PDF and try again.",
      );
      return;
    }

    setError("");
    setFile(nextFile);
  }

  function focusUploadArea() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleNewPaper() {
    setError("");
    setTransientJob(null);
    setRetryingQuestionId(null);
    setDisplayedJobId(null);
    setDisplayedJob(null);
    focusUploadArea();
  }

  function handleOpenLiveJob() {
    if (!pollJobId) {
      return;
    }

    setTransientJob(null);
    setRetryingQuestionId(null);
    setDisplayedJobId(pollJobId);
    focusUploadArea();
  }

  function handleSelectJob(jobId: string) {
    setError("");
    setTransientJob(null);
    setRetryingQuestionId(null);
    setDisplayedJobId(jobId);
  }

  async function startRetry(questionId?: string, questionLabel?: string) {
    if (isBusy) {
      return;
    }

    const job = displayedJob;

    if (!job?.draft || job.jobId.startsWith("local-")) {
      setError("Open a saved paper with extracted questions before retrying.");
      return;
    }

    if (job.status === "queued" || job.status === "running") {
      setError("This paper is already being solved. Wait for it to finish first.");
      return;
    }

    const retryLabel = questionLabel ?? "this question";
    const confirmationMessage = questionId
      ? `Regenerate the solution for ${retryLabel}? This will replace only that answer.`
      : "Continue from the already extracted questions? This will not re-extract the PDF.";

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    const retryToken = questionId ?? RETRYING_PAPER_ID;
    const currentSolutions = job.result?.solutions ?? job.partialSolutions;
    const retainedSolutions = questionId
      ? currentSolutions.filter((solution) => solution.id !== questionId)
      : currentSolutions;
    const optimisticJob: SolveJobSnapshot = {
      ...job,
      status: "running",
      stage: "solving",
      progress: Math.max(12, Math.min(job.progress, 92)),
      message: questionId
        ? `Regenerating ${retryLabel} from the extracted questions...`
        : "Continuing from the already extracted questions without re-reading the PDF...",
      totalQuestions: job.draft.questions.length,
      solvedQuestions: retainedSolutions.length,
      partialSolutions: retainedSolutions,
      result: null,
      error: null,
      updatedAt: nowIso(),
    };

    try {
      setRetryingQuestionId(retryToken);
      setError("");
      setTransientJob(null);
      setDisplayedJob(optimisticJob);
      setDisplayedJobId(job.jobId);
      setPollJobId(job.jobId);
      setHistoryItems((current) =>
        upsertHistoryItem(current, createSolveHistoryItem(optimisticJob)),
      );

      const response = await fetch(`/api/solve/${job.jobId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes,
          questionId,
        }),
      });
      const payload = await readJsonResponse<CreateJobResponse>(
        response,
        "The retry could not be started.",
      );

      if (payload.error) {
        throw new Error(payload.error);
      }

      focusUploadArea();
    } catch (retryError) {
      const message =
        retryError instanceof Error
          ? retryError.message
          : "Something unexpected happened while starting the retry.";

      setDisplayedJob(job);
      setHistoryItems((current) =>
        upsertHistoryItem(current, createSolveHistoryItem(job)),
      );
      setRetryingQuestionId(null);
      setPollJobId(null);
      setError(message);
    }
  }

  function handleContinueExtractedQuestions() {
    void startRetry();
  }

  function handleRetryQuestion(questionId: string, questionLabel: string) {
    void startRetry(questionId, questionLabel);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Upload a question paper PDF to continue.");
      return;
    }

    try {
      setIsStartingJob(true);
      setError("");
      setRetryingQuestionId(null);
      setDisplayedJob(null);
      setDisplayedJobId(null);
      setTransientJob(
        createTransientJobSnapshot(
          file.name,
          "Creating the solve job and connecting to Gemini...",
        ),
      );

      const formData = new FormData();
      formData.append("questionPaper", file);
      formData.append("notes", notes);

      const response = await fetch("/api/solve", {
        method: "POST",
        body: formData,
      });

      const payload = await readJsonResponse<CreateJobResponse>(
        response,
        "The solver could not start this question paper job.",
      );

      if (payload.error || !payload.jobId) {
        throw new Error(
          payload.error ?? "The solver could not start this question paper job.",
        );
      }

      const timestamp = new Date().toISOString();
      const optimisticJob: SolveJobSnapshot = {
        jobId: payload.jobId,
        sourceFileName: file.name,
        status: "queued",
        stage: "queued",
        progress: 2,
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

      setTransientJob(null);
      setDisplayedJob(optimisticJob);
      setDisplayedJobId(payload.jobId);
      setPollJobId(payload.jobId);
      setHistoryItems((current) =>
        upsertHistoryItem(current, createSolveHistoryItem(optimisticJob)),
      );
      hasAutoSelectedHistory.current = true;
      focusUploadArea();
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : "Something unexpected happened while starting the solver.";

      setTransientJob((current) =>
        markSnapshotAsFailed(
          current ?? createTransientJobSnapshot(file.name, message),
          message,
        ),
      );
      setError(
        message,
      );
    } finally {
      setIsStartingJob(false);
    }
  }

  return (
    <div className="workspace-shell">
      <HistorySidebar
        isLoading={isHistoryLoading}
        items={historyItems}
        liveJobId={pollJobId}
        onNewPaper={handleNewPaper}
        onOpenLiveJob={handleOpenLiveJob}
        onSelectJob={handleSelectJob}
        selectedJobId={displayedJobId}
      />

      <div className="workspace-main">
        <section className="hero-card workspace-hero">
          <div className="hero-copy">
            <span className="eyebrow">AI Revision Workspace</span>
            <h1 className="hero-title">
              Question paper answers,
              <span>now organized like study chats.</span>
            </h1>
            <p className="hero-text">
              Upload any PDF question paper and turn it into clean, structured,
              step-by-step solutions with crisp equations, chemistry structures,
              exam-ready formatting, live progress, and a reusable paper history
              you can revisit later.
            </p>
            <div className="hero-badges">
              <span className="hero-badge">Gemini 2.5 Flash</span>
              <span className="hero-badge">5-key automatic failover</span>
              <span className="hero-badge">Chemistry structure rendering</span>
              <span className="hero-badge">Live question-by-question progress</span>
              <span className="hero-badge">Saved paper sidebar</span>
            </div>
          </div>

          <div className="metrics">
            <article className="metric-card">
              <p className="metric-label">Saved Library</p>
              <p className="metric-value">{historyItems.length} papers</p>
              <p className="metric-note">
                Every solve is kept in local history so you can reopen older papers
                like a study thread instead of starting from zero.
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Current Flow</p>
              <p className="metric-value">
                {activeJob ? getStageLabel(activeJob) : "Choose or upload a paper"}
              </p>
              <p className="metric-note">
                The solver extracts the full paper first, then fills answers in
                progressively so long PDFs no longer feel frozen.
              </p>
            </article>
            <article className="metric-card">
              <p className="metric-label">Study Output</p>
              <p className="metric-value">Question-first answer sheets</p>
              <p className="metric-note">
                Questions, worked solutions, final answers, and revision notes stay
                together in one cleaner white-themed workspace.
              </p>
            </article>
          </div>
        </section>

        <section className="panel panel-live" id="new-paper">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Upload and Solve</h2>
              <p className="panel-subtitle">
                Drop in a question paper, guide the answer style, and watch the
                solver move through each stage in real time.
              </p>
            </div>
            <span
              className={`status-chip ${
                activeJob?.status === "completed"
                  ? "status-chip-done"
                  : activeJob?.status === "failed"
                    ? "status-chip-failed"
                  : isBusy
                    ? "status-chip-live"
                    : ""
              }`}
            >
              {getStageLabel(activeJob)}
            </span>
          </div>

          <form className="upload-grid" onSubmit={handleSubmit}>
            <label
              className={`upload-zone ${isDragging ? "dragging" : ""}`}
              onDragEnter={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                void updateFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <input
                accept="application/pdf"
                type="file"
                onChange={(event) =>
                  void updateFile(event.target.files?.[0] ?? null)
                }
              />

              <div className="upload-zone-copy">
                <div className="upload-icon">+</div>
                <div>
                  <p className="upload-title">Upload a question paper PDF</p>
                  <p className="upload-text">
                    The solver will detect every answerable question, generate polished
                    solutions in batches, and save the finished paper into your sidebar
                    history automatically.
                  </p>
                </div>

                {file ? (
                  <div className="file-pill">
                    <span>PDF</span>
                    <span>{file.name}</span>
                  </div>
                ) : null}
              </div>
            </label>

            <div className="helper-grid">
              <div className="textarea-shell">
                <label className="field-label" htmlFor="notes">
                  Solver instructions
                </label>
                <p className="field-note">
                  Ask for concise answers, detailed derivations, easier language,
                  diagram-heavy explanations, or marks-focused formatting.
                </p>
                <textarea
                  id="notes"
                  name="notes"
                  placeholder="Example: Keep each answer exam-ready, include formulas first, and end with a 2-line memory trick."
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>

              <aside className="helper-card helper-card-glow">
                <h3>What the upgraded workspace does</h3>
                <ol className="helper-list">
                  <li>Extracts the full question list first.</li>
                  <li>Shows detected questions before solving finishes.</li>
                  <li>Solves in smaller batches for better reliability.</li>
                  <li>Saves every paper to a reusable history sidebar.</li>
                  <li>Keeps the result layout cleaner for revision sessions.</li>
                </ol>
              </aside>
            </div>

            {activeJob ? (
              <section
                className={`progress-card ${
                  activeJob.status === "failed" ? "progress-card-failed" : ""
                }`}
              >
                <div className="progress-copy">
                  <p className="progress-kicker">Live Solve Progress</p>
                  <h3 className="progress-title">{getStageLabel(activeJob)}</h3>
                  <p className="progress-text">{activeJob.message}</p>
                </div>

                <div className="progress-meter-grid">
                  <div
                    className={`progress-orb ${
                      activeJob.status === "failed" ? "progress-orb-failed" : ""
                    }`}
                  >
                    <div className="progress-orb-inner">
                      <strong>{Math.round(activeJob.progress)}%</strong>
                      <span>{activeJob.status === "failed" ? "Failed" : "Complete"}</span>
                    </div>
                  </div>

                  <div className="progress-details">
                    <div className="progress-track">
                      <span
                        className={`progress-fill ${
                          activeJob.status === "failed" ? "progress-fill-failed" : ""
                        }`}
                        style={{ width: `${activeJob.progress}%` }}
                      />
                    </div>

                    <div className="progress-stats">
                      <span>
                        {activeJob.solvedQuestions}
                        {activeJob.totalQuestions
                          ? ` / ${activeJob.totalQuestions}`
                          : ""}{" "}
                        {activeJob.status === "failed"
                          ? "questions solved before failure"
                          : "questions solved"}
                      </span>
                      {activeJob.meta ? (
                        <span>Gemini key slot #{activeJob.meta.usedKeyIndex}</span>
                      ) : liveJobSummary ? (
                        <span>{liveJobSummary.subject}</span>
                      ) : activeJob.status === "failed" ? (
                        <span>Retry the paper after fixing the error below</span>
                      ) : (
                        <span>Waiting for Gemini response</span>
                      )}
                    </div>

                    <div className="stage-list">
                      {SOLVER_STAGES.map((stage, index) => {
                        const currentIndex = SOLVER_STAGES.indexOf(
                          activeJob.stage === "completed" || activeJob.stage === "failed"
                            ? "finalizing"
                            : (activeJob.stage as (typeof SOLVER_STAGES)[number]),
                        );
                        const isComplete = index < currentIndex;
                        const isActive = index === currentIndex && isBusy;

                        return (
                          <div
                            className={`stage-step ${
                              isComplete ? "stage-step-complete" : ""
                            } ${isActive ? "stage-step-active" : ""}`}
                            key={stage}
                          >
                            <span className="stage-dot" />
                            <span className="stage-name">{stage}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {error ? <div className="error-banner">{error}</div> : null}

            <div className="actions">
              <button className="primary-button" disabled={isBusy} type="submit">
                {isStartingJob
                  ? "Starting solver..."
                  : pollJobId
                    ? "Solver is working..."
                    : activeJob?.status === "failed"
                      ? "Try again"
                      : "Generate solutions"}
              </button>
              {canContinueExtractedQuestions ? (
                <button
                  className="secondary-button"
                  disabled={isBusy || isRetryingWholePaper}
                  onClick={handleContinueExtractedQuestions}
                  type="button"
                >
                  {isRetryingWholePaper
                    ? "Continuing extracted questions..."
                    : "Continue extracted questions"}
                </button>
              ) : null}
              <p className="muted-text">
                {activeJob?.status === "failed"
                  ? canContinueExtractedQuestions
                    ? "The paper is already extracted. Continue solving without re-reading the PDF, or retry a single failed answer below."
                    : "The solve failed. Check the error and retry the paper when you're ready."
                  : isStartingJob
                    ? "The solve job is being created now. Live progress will appear here immediately."
                    : pollJobId
                      ? "Detected questions will appear first, then solutions will fill in live below."
                      : "Best results come from legible PDFs with clear page scans."}
              </p>
            </div>
          </form>
        </section>

        {isLoadingPaper ? (
          <section className="empty-state-panel">
            <p className="empty-state-kicker">Opening Paper</p>
            <h2>Loading the selected study thread...</h2>
            <p>
              The saved paper is being loaded from your local history so you can keep
              reading exactly where you left off.
            </p>
          </section>
        ) : displayedJob?.draft || displayedJob?.result ? (
          <SolutionViewer
            draft={displayedJob.draft}
            jobId={displayedJob.jobId}
            result={displayedJob.result}
            partialSolutions={
              displayedJob.result?.solutions ?? displayedJob.partialSolutions
            }
            meta={displayedJob.meta}
            progress={displayedJob.progress}
            message={displayedJob.message}
            sourceFileName={displayedJob.sourceFileName}
            stage={displayedJob.stage}
            status={displayedJob.status}
            onRetryQuestion={handleRetryQuestion}
            retryingQuestionId={retryingQuestionId}
          />
        ) : activeJob?.status === "failed" ? (
          <section className="empty-state-panel">
            <p className="empty-state-kicker">Solve Failed</p>
            <h2>The paper could not be solved this time.</h2>
            <p>{activeJob.message}</p>
          </section>
        ) : activeJob ? (
          <section className="empty-state-panel">
            <p className="empty-state-kicker">{getStageLabel(activeJob)}</p>
            <h2>The paper is being prepared for the live answer view.</h2>
            <p>{activeJob.message}</p>
          </section>
        ) : (
          <section className="empty-state-panel">
            <p className="empty-state-kicker">No Paper Selected</p>
            <h2>Start with a new PDF or reopen one from the sidebar.</h2>
            <p>
              Your uploaded papers will live here as reusable study conversations,
              with progress, answers, and formatting preserved.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
