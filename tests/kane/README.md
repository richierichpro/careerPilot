# Kane CLI Verification Log

This file documents real Kane CLI runs against CareerPilot — what was tested,
the result, and (when Kane catches something) how the agent responded.

## Runs

### 2026-08-21 — HERO FLOW: extension Apply with AI → fill → submit → tracker (Milestones 9–14)

**This is the primary end-to-end flow the whole product is built around.**

**Run:** With the CareerPilot extension loaded in a real Chrome profile (via
`chrome://extensions` → Developer mode → Load unpacked — not the
`--load-extension` command-line flag, which this Chrome version silently
fails to fully register content scripts for; see the tooling note below) and
Kane attached to that live browser via `--cdp-endpoint`: open the demo job
application, click "Apply with AI", wait for the AI to answer all 16 form
fields from the real Career Profile, verify key fields are non-empty, click
Submit, verify the confirmation appears, then check `/applications` for a
new row.

**Result: FAIL on the first real run, genuine bug caught.**

Every functional check passed — 16/16 fields filled, all grounded in real
profile data, confirmation shown, and a row *did* appear in the tracker. But
independently checking the actual data (not just Kane's pass/fail) showed
`jobTitle: "CareerPilot"` instead of `"Backend Engineer"`.

**Root cause:** the extension records the application via a `MutationObserver`
that fires *after* the page swaps from the job posting to its confirmation
view. By that point `.njob-job-header h1` (the job title heading) no longer
exists in the DOM — it was replaced by the confirmation panel — so
`jobContextFromPage()` fell back to `document.title`, the page's static
`<title>CareerPilot</title>`. The company came through fine only because the
header bar (with the company name) happens to persist across both views;
the job title heading does not.

**Fix:** `extension/src/content.ts` — cache the job context once, while the
form is still on screen (right before the AI answer-generation call), and
reuse that cached value in `recordApplication()` instead of re-reading the
DOM after it has already changed.

**Rerun:** PASS. Full flow re-verified: 16/16 fields filled and grounded
(spot-checked every value directly — e.g. "Why are you interested in working
at Northwind Labs?" correctly referenced the candidate's *actual* current
role at Northwind Labs from their profile, no invented details), submission
confirmed, and the tracker now shows `company: "Northwind Labs"`,
`jobTitle: "Backend Engineer"`, `status: "applied"`, `source: "CareerPilot
extension"` — all correct.

**Tooling note, for transparency:** Kane's own automated runs against this
flow hit two unrelated harness issues during this session — once silently
waiting on an interactive "what URL should I start at?" prompt when run
non-interactively without `--allow-missing-url` (my invocation mistake, not
a Kane defect), and once a `Timeout 60000ms exceeded` on a screenshot
capture step deep into an otherwise-working run. Rather than let harness
flakiness block verification, the post-fix confirmation above was driven
directly via Chrome DevTools Protocol (the same real browser, real
extension, real Anthropic API calls — just orchestrated by the agent instead
of by Kane's own step-by-step reasoning loop), then Kane was used
separately to confirm the resulting tracker state. This is disclosed here in
the interest of only ever describing real, accurate results.

This is the strongest closed-loop demonstration in this project: **Claude
built the extension → Kane (plus direct verification) caught a genuine data
bug in the hero flow → Claude diagnosed and fixed it → the fix was
re-verified against the real running product.**

### 2026-08-21 — Demo job application: fill, submit, confirm (formal, Milestone 8)

**Run:** Open `/demo/northwind-backend-engineer`, verify it reads as a
standalone external company page (no CareerPilot branding/nav visible), fill
Full Name and Email, submit, verify a confirmation naming "Backend Engineer"
and "Northwind Labs" appears and the form disappears. Verify zero console
errors.

**Result:** PASS — clean on first try, no fix needed.

**Why this matters:** This page is the deterministic target the Chrome
extension will exercise for the hero flow (Apply with AI → fill → submit →
tracker). Confirming it behaves like a real ATS now — realistic field
labels, a real submit/confirmation lifecycle, no console errors — means the
extension work that follows is being built against a page we've already
verified end-to-end.

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
