import type { NextConfig } from "next";

const appPort = process.env.PORT || "3003";

const nextConfig: NextConfig = {
  allowedDevOrigins: [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@google/genai"],
};

export default nextConfig;
