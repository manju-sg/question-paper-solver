"use client";

import type { SolveHistoryItem } from "@/lib/solution-schema";

type HistorySidebarProps = {
  items: SolveHistoryItem[];
  isLoading: boolean;
  liveJobId: string | null;
  selectedJobId: string | null;
  onNewPaper: () => void;
  onOpenLiveJob: () => void;
  onSelectJob: (jobId: string) => void;
};

function formatRelativeTime(value: string) {
  const target = Date.parse(value);
  const deltaMs = target - Date.now();
  const absMs = Math.abs(deltaMs);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < hour) {
    return formatter.format(Math.round(deltaMs / minute), "minute");
  }

  if (absMs < day) {
    return formatter.format(Math.round(deltaMs / hour), "hour");
  }

  return formatter.format(Math.round(deltaMs / day), "day");
}

function getStatusLabel(item: SolveHistoryItem) {
  if (item.status === "completed") {
    return "Solved";
  }

  if (item.status === "failed") {
    return "Needs retry";
  }

  return `${Math.round(item.progress)}%`;
}

export function HistorySidebar({
  items,
  isLoading,
  liveJobId,
  selectedJobId,
  onNewPaper,
  onOpenLiveJob,
  onSelectJob,
}: HistorySidebarProps) {
  const shouldOfferLiveShortcut = Boolean(liveJobId && selectedJobId !== liveJobId);

  return (
    <aside className="history-sidebar">
      <div className="sidebar-top">
        <div className="brand-card">
          <div className="brand-mark">
            <span />
          </div>
          <div>
            <p className="brand-label">Study OS</p>
            <h1 className="brand-title">Paper Solver</h1>
            <p className="brand-text">
              Upload, solve, revisit, and compare your previous papers in one calm
              revision workspace.
            </p>
          </div>
        </div>

        <div className="sidebar-actions">
          <button className="sidebar-primary-button" onClick={onNewPaper} type="button">
            New paper
          </button>

          {shouldOfferLiveShortcut ? (
            <button
              className="sidebar-secondary-button"
              onClick={onOpenLiveJob}
              type="button"
            >
              Open current solve
            </button>
          ) : null}
        </div>
      </div>

      <div className="history-panel">
        <div className="history-panel-header">
          <div>
            <p className="history-kicker">Recent Papers</p>
            <h2 className="history-title">Saved history</h2>
          </div>
          <span className="history-count">{items.length}</span>
        </div>

        {isLoading ? (
          <div className="history-empty">
            <p>Loading saved papers...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="history-empty">
            <p>Your solved papers will appear here.</p>
            <span>Each upload becomes a reusable study thread with live progress.</span>
          </div>
        ) : (
          <div className="history-list">
            {items.map((item) => {
              const isSelected = item.jobId === selectedJobId;
              const isLive = item.jobId === liveJobId;

              return (
                <button
                  className={`history-item ${isSelected ? "history-item-selected" : ""}`}
                  key={item.jobId}
                  onClick={() => onSelectJob(item.jobId)}
                  type="button"
                >
                  <div className="history-item-top">
                    <span className={`history-status ${item.status}`}>
                      {isLive ? "Live" : getStatusLabel(item)}
                    </span>
                    <span className="history-time">{formatRelativeTime(item.updatedAt)}</span>
                  </div>

                  <strong className="history-item-title">{item.title}</strong>
                  <span className="history-item-subject">{item.subject}</span>
                  <p className="history-item-preview">{item.previewText}</p>

                  <div className="history-item-footer">
                    <span>{item.solvedQuestions}{item.totalQuestions ? `/${item.totalQuestions}` : ""} solved</span>
                    <span>{item.sourceFileName}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
