# CareerPilot

An AI-powered job application assistant. Upload a resume once — Claude turns
it into a structured Career Profile, grounded strictly in what the resume
actually says. A Chrome extension then reads real job application forms,
semantically answers each question from that profile (never inventing
experience), fills the form, and records the submission in a live tracker —
detected by Claude actually reading the confirmation page, not a URL/regex
heuristic.

Built with **Claude Code**. Verified with **Kane CLI** driving real browser
sessions against both a local demo page and live external job sites.

### 📋 [Kane CLI test log — real run history](tests/kane/README.md)

Every verification run is logged honestly, including the ones that failed —
most notably a real incident where Kane accidentally submitted a live
application despite an explicit instruction not to, caught by independently
verifying rather than trusting its own self-report, and fixed.
<img width="1440" height="900" alt="Screenshot 2026-08-21 at 11 44 58 PM" src="https://github.com/user-attachments/assets/cbe5911c-d7ae-4c22-8efb-cf2aa82321ee" />


## Load the extension

Pre-built and committed to the repo — no install or build step needed:

1. `git clone https://github.com/richierichpro/careerPilot.git`
2. Open `chrome://extensions`, toggle **Developer mode** on (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Upload a resume at the web app (opens from the popup's "Career Profile"
   button) — Claude extracts your Career Profile
5. Open any real job application page (field detection is generic —
   `label[for]`, wrapping `<label>`, `aria-label`, `aria-labelledby`, then
   `placeholder` — not tied to any one site's markup) and click the
   extension's icon in the toolbar
6. If a fillable form was detected on the page, an **Apply with AI** button
   appears in the popup — click it and keep the popup open to watch live
   progress ("Reading the form…", "AI is answering N fields…", "Filled X of
   Y fields")
7. Review the highlighted fields — solid blue outline for what the AI
   filled, dashed orange for anything it couldn't ground in your profile and
   left for you to fill in yourself — then submit the form yourself; the
   extension never auto-submits
8. Open the Applications link in the popup — the submission is recorded
   automatically once Claude reads the resulting confirmation page and
   determines it's genuinely a match for that application

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

## Status

All core milestones complete and deployed: resume upload, Anthropic-powered
profile extraction, a JSON-backed application tracker, a demo job
application page, and the full Chrome extension (field detection → AI
answer generation → autofill → AI-verified submission tracking). See commit
history — each milestone landed as its own small commit — and
[tests/kane/README.md](tests/kane/README.md) for verification evidence.
