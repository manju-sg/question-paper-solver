import { spawn } from "node:child_process";
import path from "node:path";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const args = process.argv.slice(2);
const command = args[0];

if (!command || !["dev", "build", "start"].includes(command)) {
  console.error(
    "Usage: node scripts/run-next.mjs <dev|build|start> [--port <port>] [--distDir <dir>]",
  );
  process.exit(1);
}

let port;
let distDir;

loadEnvConfig(process.cwd(), command === "dev");

for (let index = 1; index < args.length; index += 1) {
  const value = args[index];

  if (value === "--port") {
    port = args[index + 1];
    index += 1;
    continue;
  }

  if (value === "--distDir") {
    distDir = args[index + 1];
    index += 1;
  }
}

function resolvePort() {
  const candidate = `${port || process.env.PORT || ""}`.trim();

  if (!candidate) {
    return "3003";
  }

  return candidate;
}

const nextBin = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);

const childArgs = [nextBin, command];

if (command === "dev" || command === "start") {
  childArgs.push("-p", resolvePort());
}

const child = spawn(process.execPath, childArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir || process.env.NEXT_DIST_DIR || ".next",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
