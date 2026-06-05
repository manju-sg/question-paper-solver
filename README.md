# Question Paper Solver

A polished PDF question-paper solver built with Next.js and Gemini 2.5 Flash. Users can upload a question paper PDF and get clean, step-by-step solutions with rendered equations, PDF export, and study-friendly formatting.

## Features

- PDF upload flow tailored for scanned or digital question papers
- Gemini-powered extraction and solving with `gemini-2.5-flash`
- Automatic failover across 5 API keys
- Structured JSON output for dependable rendering
- OCR/text artifact cleanup for symbols such as arrows, negation, and quantifiers
- PDF-aware batch solving so diagrams, tables, and options stay available while answers are generated
- White glassmorphism UI with animated gradients
- KaTeX equation rendering and print-ready PDF export

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file:

   ```bash
   copy .env.example .env.local
   ```

3. Add up to 5 Gemini API keys in `.env.local`.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:<PORT>` using the `PORT` value from your env file.

## Environment Variables

- `PORT`: app port used by the launcher for `dev` and `start`
- `GEMINI_MODEL`: defaults to `gemini-2.5-flash`
- `GEMINI_API_KEY_1` through `GEMINI_API_KEY_5`: tried in order until one succeeds

## Local Port

- The app now reads `PORT` from your env file before starting Next.js.
- If `PORT` is not set, it falls back to `3003`.
- Dev output is written to `.next-dev` and production output is written to `.next-prod`, so running a local dev server no longer interferes with production builds.

## Notes

- This implementation follows Google's official Gemini file-upload and structured-output patterns.
- The app expects PDF uploads up to 50 MB.
- For deployment, make sure your platform allows large multipart uploads and long-running AI requests.
