"use client";

import { useEffect } from "react";

type PrintAutoTriggerProps = {
  autoPrint: boolean;
  paperTitle: string;
  subject: string;
};

export function PrintAutoTrigger({
  autoPrint,
  paperTitle,
  subject,
}: PrintAutoTriggerProps) {
  useEffect(() => {
    if (!autoPrint) {
      return;
    }

    let timer = 0;
    let attempts = 0;

    const waitForPrintableState = () => {
      const structures = Array.from(
        document.querySelectorAll<HTMLElement>("[data-chem-structure='true']"),
      );
      const allStructuresReady = structures.every(
        (node) => node.dataset.chemReady === "true",
      );

      if (allStructuresReady || attempts >= 40) {
        timer = window.setTimeout(() => {
          window.print();
        }, 220);

        return;
      }

      attempts += 1;
      timer = window.setTimeout(waitForPrintableState, 150);
    };

    waitForPrintableState();

    return () => window.clearTimeout(timer);
  }, [autoPrint]);

  return (
    <section className="print-toolbar no-print">
      <div>
        <p className="print-toolbar-kicker">PDF Export</p>
        <h1 className="print-toolbar-title">{paperTitle}</h1>
        <p className="print-toolbar-text">
          {subject}. Use your browser&apos;s <strong>Save as PDF</strong> destination
          for a clean downloadable answer sheet.
        </p>
      </div>

      <div className="print-toolbar-actions">
        <button className="print-button" onClick={() => window.print()} type="button">
          Print / Save PDF
        </button>
        <button
          className="print-secondary-button"
          onClick={() => window.close()}
          type="button"
        >
          Close
        </button>
      </div>
    </section>
  );
}
