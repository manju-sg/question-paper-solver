import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintAutoTrigger } from "@/components/print-auto-trigger";
import { SolutionViewer } from "@/components/solution-viewer";
import { getSolveJob } from "@/lib/solve-job-store";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ autoprint?: string }>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const { jobId } = await params;
  const job = getSolveJob(jobId);

  if (!job) {
    return {
      title: "Question Paper PDF Export",
    };
  }

  const paperTitle =
    job.result?.paperTitle ?? job.draft?.paperTitle ?? "Question Paper";

  return {
    title: `${paperTitle} | PDF Export`,
  };
}

export default async function PrintPage({
  params,
  searchParams,
}: PageProps) {
  const [{ jobId }, { autoprint }] = await Promise.all([params, searchParams]);
  const job = getSolveJob(jobId);

  if (!job || (!job.draft && !job.result)) {
    notFound();
  }

  const paperTitle = job.result?.paperTitle ?? job.draft?.paperTitle ?? "Question Paper";
  const subject = job.result?.subject ?? job.draft?.subject ?? "Question Paper";

  return (
    <main className="print-page">
      <div className="print-shell">
        <PrintAutoTrigger
          autoPrint={autoprint === "1"}
          paperTitle={paperTitle}
          subject={subject}
        />

        <section className="print-surface">
          <SolutionViewer
            draft={job.draft}
            isPrintView
            jobId={job.jobId}
            message={job.message}
            meta={job.meta}
            partialSolutions={job.result?.solutions ?? job.partialSolutions}
            progress={job.progress}
            result={job.result}
            sourceFileName={job.sourceFileName}
            stage={job.stage}
            status={job.status}
          />
        </section>
      </div>
    </main>
  );
}
