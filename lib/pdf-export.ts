import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PDF_RENDER_TIMEOUT_MS = 45_000;
const PDF_READY_TIMEOUT_MS = 5_000;
const PDF_EXPORT_DIR = join(tmpdir(), "question-paper-solver-pdf");

type BrowserAttemptResult = {
  ok: boolean;
  output: string;
};

function getBrowserCandidates() {
  return [
    process.env.PDF_BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForPdfFile(filePath: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < PDF_READY_TIMEOUT_MS) {
    try {
      const details = await stat(filePath);

      if (details.size > 0) {
        const pdf = await readFile(filePath);
        const tail = pdf.subarray(Math.max(0, pdf.length - 2048)).toString("ascii");

        if (tail.includes("%%EOF")) {
          return pdf;
        }
      }
    } catch {
      // Chrome may not have created the output file yet.
    }

    await sleep(150);
  }

  throw new Error("The browser did not finish writing a valid PDF file.");
}

function runBrowser(
  browserPath: string,
  args: string[],
  timeoutMs: number,
): Promise<BrowserAttemptResult> {
  return new Promise((resolve) => {
    const child = spawn(browserPath, args, {
      windowsHide: true,
    });
    let output = "";
    let didFinish = false;
    const timer = setTimeout(() => {
      if (!didFinish) {
        child.kill("SIGKILL");
        didFinish = true;
        resolve({
          ok: false,
          output: `${output}\nTimed out while waiting for Chrome/Edge to create the PDF.`,
        });
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      if (didFinish) {
        return;
      }

      clearTimeout(timer);
      didFinish = true;
      resolve({ ok: false, output: error.message });
    });
    child.on("exit", (code) => {
      if (didFinish) {
        return;
      }

      clearTimeout(timer);
      didFinish = true;
      resolve({
        ok: code === 0,
        output,
      });
    });
  });
}

function createBrowserArgs({
  headlessMode,
  outputPath,
  profilePath,
  url,
}: {
  headlessMode: "new" | "old";
  outputPath: string;
  profilePath: string;
  url: string;
}) {
  return [
    headlessMode === "new" ? "--headless=new" : "--headless",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=12000",
    "--print-to-pdf-no-header",
    `--user-data-dir=${profilePath}`,
    `--print-to-pdf=${outputPath}`,
    url,
  ];
}

export async function renderUrlToPdf(url: string) {
  await mkdir(PDF_EXPORT_DIR, { recursive: true });

  const candidates = getBrowserCandidates();
  const attemptedErrors: string[] = [];

  for (const browserPath of candidates) {
    if (!existsSync(browserPath)) {
      continue;
    }

    for (const headlessMode of ["new", "old"] as const) {
      const id = crypto.randomUUID();
      const outputPath = join(PDF_EXPORT_DIR, `${id}.pdf`);
      const profilePath = join(PDF_EXPORT_DIR, `${id}-profile`);

      try {
        await mkdir(profilePath, { recursive: true });

        const result = await runBrowser(
          browserPath,
          createBrowserArgs({
            headlessMode,
            outputPath,
            profilePath,
            url,
          }),
          PDF_RENDER_TIMEOUT_MS,
        );

        if (!result.ok) {
          attemptedErrors.push(`${browserPath}: ${result.output.trim()}`);
          continue;
        }

        return await waitForPdfFile(outputPath);
      } catch (error) {
        attemptedErrors.push(
          `${browserPath}: ${
            error instanceof Error ? error.message : "Unknown PDF render error"
          }`,
        );
      } finally {
        await unlink(outputPath).catch(() => undefined);
        await rm(profilePath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  throw new Error(
    [
      "Could not create the PDF automatically because Chrome or Edge could not render the print page.",
      "Install Google Chrome/Microsoft Edge or set PDF_BROWSER_PATH to a Chromium-based browser.",
      attemptedErrors.length ? `Last errors: ${attemptedErrors.slice(-2).join(" | ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}
