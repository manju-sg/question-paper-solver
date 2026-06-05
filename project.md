# Question Paper Solver Project

## Overview

Question Paper Solver is a study-focused web app that lets a user upload a question paper PDF and receive clean, step-by-step AI solutions. It is designed to be faster to read, easier to revise from, and more polished than a typical answer key.

The app uses Gemini 2.5 Flash to:

- read the uploaded PDF
- extract answerable questions
- solve the paper in batches
- render equations cleanly with KaTeX
- show live progress while answers are being generated
- save previous papers in a sidebar history for later review

## Main Goal

The goal of this project is to turn raw exam PDFs into a study workspace that feels closer to ChatGPT or Gemini history than a static solver.

Instead of waiting for one giant AI response, the app:

1. uploads the PDF
2. extracts questions first
3. shows progress live
4. fills answers in question by question
5. saves the solved paper so it can be reopened later

## Core Features

- PDF upload for question papers up to 50 MB
- Gemini 2.5 Flash solving pipeline
- automatic failover across 5 Gemini API keys
- structured JSON output using schemas for safer rendering
- white-themed glassmorphism UI with animated live gradients
- KaTeX math rendering for equations
- live solve progress with stages and percentages
- question-first rendering so the paper appears before all answers finish
- local saved-paper history shown in a sidebar
- reusable solved-paper view with overview, study tips, and final answers

## How The App Works

### 1. Upload

The user uploads a PDF and optionally adds instructions such as:

- make answers concise
- include full derivations
- use simpler language
- focus on exam-ready formatting

### 2. Job Creation

The backend creates a solve job and stores its snapshot locally. This snapshot includes:

- status
- stage
- progress
- extracted draft questions
- partial solutions
- final solved result

### 3. Progressive Solving

The Gemini flow is intentionally split into stages:

1. `uploading`
2. `extracting`
3. `solving`
4. `finalizing`

This makes the app feel responsive and avoids the "stuck loading forever" experience.

### 4. History Persistence

Every paper is written into a local history file so it can be reopened later from the sidebar. This gives the project a chat-like study workflow instead of a one-time upload flow.

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Gemini API via `@google/genai`
- Zod for schemas and validation
- React Markdown for structured answer rendering
- KaTeX for equations
- custom CSS for white glassmorphism styling

## Current Project Structure

### Frontend

- `components/upload-form.tsx`
  Main workspace, upload flow, progress state, and history/sidebar integration.

- `components/history-sidebar.tsx`
  Sidebar that lists previous papers like saved chats.

- `components/solution-viewer.tsx`
  Renders extracted questions, step-by-step answers, and final answers.

- `app/globals.css`
  White glassmorphism styling, live gradients, sidebar layout, and responsive design.

### Backend

- `app/api/solve/route.ts`
  Starts a new solve job from an uploaded PDF.

- `app/api/solve/[jobId]/route.ts`
  Returns live job status and results for one paper.

- `app/api/solve/history/route.ts`
  Returns saved paper history for the sidebar.

### Core Logic

- `lib/gemini.ts`
  Handles Gemini upload, extraction, batch solving, failover across API keys, and progress reporting.

- `lib/solve-job-store.ts`
  Stores live jobs and persists history to disk.

- `lib/solve-history.ts`
  Builds compact history cards for the sidebar.

- `lib/solution-schema.ts`
  Defines Zod schemas for questions, solutions, job snapshots, and history items.

## UI Direction

The design is intentionally not a plain dashboard. The current interface aims for:

- a clean white study environment
- glassmorphism panels
- soft moving gradients
- a premium "study workspace" feel
- a left sidebar like ChatGPT or Gemini history
- a right content area for the active paper

## Running The Project

The app is pinned to port `3003`.

Useful commands:

```bash
npm run dev
npm run build
npm run start
npm run typecheck
```

## Environment Variables

- `GEMINI_MODEL`
- `GEMINI_API_KEY_1`
- `GEMINI_API_KEY_2`
- `GEMINI_API_KEY_3`
- `GEMINI_API_KEY_4`
- `GEMINI_API_KEY_5`

The solver tries the keys in order and automatically switches if one fails.

## Important Notes

- The app currently uses KaTeX for equation rendering.
- Mermaid rendering has been removed from the live solution view to avoid diagram syntax/render errors.
- Saved paper history is local to this project instance.
- Large PDFs depend on Gemini file processing time, so progress updates are important to the experience.

## Project Value

This project is useful because it combines:

- AI solving
- structured rendering
- progress feedback
- revision-friendly formatting
- saved paper history

That makes it feel less like a demo and more like a practical study product.
