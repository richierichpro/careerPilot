# Kane CLI Verification Log

This file documents real Kane CLI runs against CareerPilot — what was tested,
the result, and (when Kane catches something) how the agent responded.

## Runs

### 2026-08-21 — Applications tracker renders real backend data (formal, Milestone 7)

**Run:** Seed two applications via `POST /api/applications` (Northwind Labs /
Backend Engineer / interview / with notes, and Acme Corp / Backend Engineer /
interview), open `/applications`, verify both rows render with the correct
company, job title, status badge, and notes; verify zero console errors.

**Result:** First attempt FAILED on one checkpoint ("a second row for 'Acme
Corp' is shown"); Kane's own summary suspected its row-matching logic, not
the app. Rather than accept that self-diagnosis at face value either, the
agent re-ran a second, unambiguous Kane query asking it to directly read
`tbody tr` count and every company name via `querySelectorAll` — result: 2
rows, `["Northwind Labs", "Acme Corp"]`, exactly correct. The two seeded rows
share the same job title ("Backend Engineer"), which is the likely cause of
the first run's row-identity confusion in its accessibility-role locator.

**Conclusion:** Verified false positive, not a real defect — no code change
made. What this run actually verifies: the tracker table correctly renders
real rows from the SQLite-backed `/api/applications` endpoint (company, role,
status badge, notes), which is the tracker's core job. Sessions:
`626121f0-c3df-4293-a228-0c445cd72d17` (first, failed) →
`99612a98-3f0e-4216-8f95-92bf012e787c` (direct DOM check, passed).

### 2026-08-21 — Resume upload → AI Career Profile extraction (formal, Milestone 4)

**Run:** Open `/onboarding`, upload a real `.txt` resume through the dropzone's
file input, wait for upload + AI analysis to finish, then verify the rendered
Career Profile: name, an Experience entry correctly split into company "Acme
Corp" / title "Software Engineering Intern" (from the source text "Software
Engineering Intern, Acme Corp"), "Python" listed under Skills, and the stored
work authorization / salary expectation text. Verify zero console errors.

**Result:** PASS

**What this verifies:** The core AI pipeline the whole product depends on —
real multipart upload to the server, a live Anthropic API call
(`claude-opus-5` via `messages.parse` with a Zod structured-output schema),
and semantic normalization of resume text into structured fields (not literal
keyword copying). This is a major end-to-end behavior, not a trivial check.
Session: `ccd615aa-736e-4584-b80c-26efb6d5aae8`.

**Note — a real bug surfaced before this run, caught by direct API testing
(not Kane):** the first version of the extraction schema marked every
optional field `.nullable()`, hitting Anthropic's 16-field cap on
nullable/union-typed schema properties (mine had 20) — the API returned a 400
`invalid_request_error`. Found via a direct `curl` test against
`/api/profile/parse` with a real uploaded resume, before ever involving Kane.
Fixed by making every field a required string/array with an empty-string/
empty-array sentinel for "not stated", converted back to `undefined` after
parsing — which also sidesteps the field cap entirely. Re-tested via curl,
confirmed correct output, then the Kane run above verified it through the
actual UI.

### 2026-08-21 — Onboarding page sanity check (ad hoc, during Milestone 2)

### 2026-08-21 — Onboarding page sanity check (ad hoc, during Milestone 2)

**Run:** Open `/onboarding`, verify the Career Profile heading and resume
dropzone render and are usable, verify zero console errors, navigate to
`/applications` via the nav and verify it renders correctly with zero
console errors.

**Result:** FAIL

**What Kane found:** Every functional assertion passed (heading text,
dropzone copy, dropzone clickability, file input present, nav links,
Applications page heading, URL navigation) — but the console-error check
reported exactly 1 error instead of 0.

**Agent response:** Rather than trust Kane's own auto-generated verdict
(which guessed this might be a harness/assertion bug), the agent verified
directly: `curl -I http://localhost:5174/favicon.ico` returned 404. The
page had no favicon, so Chrome's automatic favicon request was logging a
real "failed to load resource" console error on every page load. Fixed by
adding `web/public/favicon.svg` and linking it from `index.html`.

**Rerun:** PASS — same flow, `console_errors: 0` on both `/onboarding` and
`/applications`. Session:
`c36b28b3-2845-4982-a2e5-af66e4c09983`.

This is a real instance of the Claude ↔ Kane closed loop: Kane caught a
genuine (if minor) defect during normal development — not a scripted
demo — the agent diagnosed it independently of Kane's own guess, fixed
it, and Kane re-verified.
