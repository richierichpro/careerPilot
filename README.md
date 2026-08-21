# CareerPilot

An AI-powered job application assistant. Upload a resume once — Claude turns
it into a structured Career Profile, grounded strictly in what the resume
actually says. A Chrome extension then reads real job application forms,
semantically answers each question from that profile (never inventing
experience), fills the form, and records the submission in a live tracker.

Built with **Claude Code**. Verified end-to-end with **Kane CLI** — see
[tests/kane/README.md](tests/kane/README.md) for real run history, including
a genuine bug Kane caught in the hero flow and how it was fixed.

## Structure

```
/web        Vite + React + TypeScript — Career Profile onboarding, application tracker,
            and a demo job application page for Kane/the extension to exercise
/server     Express + TypeScript — API backend, holds the Anthropic API key
/extension  Manifest V3 Chrome extension — reads forms, calls the backend for
            AI-generated answers, fills them in, records successful submissions
/shared     Shared TypeScript types used across web, server, and extension
/tests/kane Kane CLI verification flows, fixtures, and the run log
```

## Setup

Requires Node.js 20+.

```bash
npm install
cp server/.env.example server/.env   # then fill in ANTHROPIC_API_KEY
```

## Running

```bash
npm run dev:server   # API on http://localhost:8787
npm run dev:web      # web app — watch the terminal for the port (5173, or 5174 if that's taken)
```

## Try the full flow

1. Open `http://localhost:5173/onboarding` (or whichever port `dev:web` printed) and upload a resume (PDF/DOC/DOCX/TXT). Claude extracts a structured Career Profile — watch it appear below the upload.
2. Load the Chrome extension (below), then open `http://localhost:5173/demo/northwind-backend-engineer` — a realistic fictional job application page.
3. Click the **Apply with AI** button in the bottom-right corner. The extension reads the form, calls the backend for AI-generated answers grounded in your Career Profile, and fills every field — blue outline for fields it filled, dashed orange for anything it couldn't ground in your profile and left for you to fill in yourself.
4. Review, then click **Submit Application**.
5. Open `http://localhost:5173/applications` — the submission is recorded automatically.

### Loading the extension

Chrome's `--load-extension` command-line flag doesn't fully register content
scripts on recent Chrome versions, so use the real UI flow:

1. `npm run build --workspace=extension`
2. Open `chrome://extensions`, toggle **Developer mode** on (top right)
3. Click **Load unpacked** → select the `extension/` folder (not `extension/dist`)

## Status

All core milestones complete: resume upload, Anthropic-powered profile
extraction, SQLite-backed application tracker, a demo job application page,
and the full Chrome extension (field detection → AI answer generation →
autofill → submission tracking). See commit history — each milestone landed
as its own small commit — and [tests/kane/README.md](tests/kane/README.md)
for verification evidence.
