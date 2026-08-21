# CareerPilot

An AI-powered job application assistant: build a Career Profile from your
resume, then let a Chrome extension use it to answer and fill real job
application forms with Anthropic-generated, profile-grounded answers.

## Structure

```
/web        Vite + React + TypeScript — Career Profile onboarding & application tracker
/server     Express + TypeScript — API backend, holds the Anthropic API key
/extension  Manifest V3 Chrome extension — AI autofill
/shared     Shared TypeScript types used across web, server, and extension
/tests/kane Kane CLI verification flows and run log
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
npm run dev:web       # web app on http://localhost:5173
```

### Loading the extension

1. `npm run build --workspace=extension`
2. Open `chrome://extensions`, enable Developer Mode
3. "Load unpacked" → select the `extension/` directory

## Status

Milestone 1: project foundation. See commit history for progress —
each milestone lands as its own small commit.
