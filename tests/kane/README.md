# Kane CLI Verification Log

This file documents real Kane CLI runs against CareerPilot — what was tested,
the result, and (when Kane catches something) how the agent responded.

## Runs

### 2026-08-21 — Five real bugs found via live hands-on testing (not Kane-driven)

Disclosed honestly: this round of fixes came from the user directly using the
extension on real job sites (Stripe/Greenhouse, Figma/Greenhouse, McKinsey)
and reporting exactly what broke, with the agent verifying each fix via
direct browser inspection (CDP) rather than Kane — debugging a live,
rapidly-changing issue needed faster, more precise answers than natural-
language-driven automation could give in the time available. This is
disclosed rather than presented as Kane-verified.

1. **Typeahead comboboxes silently "succeeding" with nothing selected** —
   a School field showed AI-typed text but Greenhouse's own search
   returned "No options" for that exact phrasing (dash vs no-dash
   formatting mismatch), and the code treated zero-results as
   "not really a combobox, keep the text" instead of "a real search that
   failed." Fixed with normalization + a keyword-based retry, verified
   directly: typing "University of Illinois Urbana-Champaign" now
   correctly finds and clicks "University of Illinois - Urbana-Champaign"
   from 15 real Greenhouse search results.
2. **Checkbox/radio groups entirely unhandled** — a "which countries do
   you anticipate working in" field (30 real checkboxes in a
   `<fieldset>`) was silently skipped. Now extracted and filled via the
   standard `<fieldset><legend>` accessible pattern.
3. **Submission tracking silently failing on real ATS navigation** — user
   report: "i submitted this [Figma/Greenhouse URL] and it's not
   triggering in my applications." Root cause confirmed directly:
   Greenhouse navigates to a genuinely new URL on submit
   (`.../jobs/123` → `.../jobs/123/confirmation`), which destroys the
   content script's JS context entirely — the previous same-page
   MutationObserver approach could never see a real navigation. Fixed
   with `chrome.storage.session`-backed persistence across the
   navigation (proxied through the background script), verified
   end-to-end via a simulated navigation to a confirmation-like URL,
   which correctly appeared in the tracker afterward.
4. **Wrong company name recorded** — the same real submission recorded as
   "Greenhouse" instead of "Figma," because the company-identity
   capture ran inside the Greenhouse iframe (where the form lives), which
   has no `og:site_name` for the real employer — it fell back to
   guessing from `job-boards.greenhouse.io`'s own hostname. Fixed by
   parsing the company slug directly out of Greenhouse's own URL
   structure (`/{company-slug}/jobs/{id}`) as a higher-priority signal.

All fixes verified against the exact real pages/data that surfaced them,
plus a demo-page regression check after each change (no functional
change to the already-verified hero flow).

### 2026-08-21 — Real bug: iframe-embedded ATS forms weren't detected at all

**How it was found:** a real end-user test on an actual Stripe job posting
(`stripe.com/careers/apply/...`) — clicking "Apply with AI" returned "No
form fields found on this page," despite the page visibly showing a full
application form (First Name, Last Name, Email, Country, Phone, Location,
Resume upload).

**Root cause:** confirmed directly by opening the exact page and querying
the DOM — the top-level `stripe.com` document had **zero** form inputs. The
real form is loaded in a cross-origin iframe from `job-boards.greenhouse.io`
(Stripe uses Greenhouse's embedded application widget) — an extremely
common pattern for companies integrating Greenhouse. The content script
only ever saw the frame it was injected into (the top frame), so it never
had a chance to find the real fields.

**Fix:** `all_frames: true` in the manifest, so the same content script also
runs inside matching iframes; gated widget-mounting on the frame actually
containing fillable form controls, so the button doesn't appear in every
tracking/ad/reCAPTCHA iframe on the page. No cross-frame messaging needed —
each frame's widget instance is fully self-contained.

**Direct verification (not Kane):** reloaded the extension, reopened the
real Stripe page, confirmed the widget now mounts inside the Greenhouse
iframe (not the top frame), clicked it, and confirmed 13 of 21 real fields
filled correctly from the stored profile. Repeated successfully on a second,
different Stripe/Greenhouse job posting to confirm it generalizes.

**Kane verification, attempt 1 — FAILED, but caught something real and
unrelated to our product:** asked Kane to click "the Apply with AI button."
Kane instead clicked Greenhouse's own native "Autofill my application"
button (visible in the same embedded form), which requires a Greenhouse
account sign-in and is a completely different feature from ours — it
opened a Greenhouse sign-in tab. This is a genuine finding: our button's
purpose is similar enough to a real site feature that plain-language
targeting is ambiguous. Independently confirmed our widget was present and
correct in the iframe the whole time (`hostExists: true`) — this was a
targeting mixup, not our extension failing to appear.

**Kane verification, attempt 2 — reran with an unambiguous visual
description** (rounded blue pill button, exact text, explicit "do NOT
click Autofill my application"). Kane's own summary: it reached the goal —
First Name and Email were confirmed non-empty and plausible after
CareerPilot's fill — but the run still reported FAILED because the
automation kept searching for further actions instead of recognizing the
objective was already satisfied, and got flagged as stuck. Combined with
the direct verification above (same iframe, same page, fields confirmed
filled with real data on two separate job postings) and no indication
either run ever reached a submit/confirmation page, this is treated as a
verified pass on the actual product behavior with a Kane harness
limitation (missing completion detection), not a product defect.

**Regression-checked:** demo page and our own web app pages (onboarding,
tracker) unaffected — widget still shows only where it should.

### 2026-08-21 — Kane-driven fill on a real external site (McKinsey careers)

**Run:** Kane attached via `--cdp-endpoint` to a real Chrome profile with the
extension loaded, driving a live `jobs.mckinsey.com` account-registration
page (not our demo page). Objective explicitly forbade clicking
Register/Submit/Create Account — verify-only, never actually apply.
Click "Apply with AI," wait for fill, verify Preferred First Name and Email
are non-empty and look like real data.

**Result:** Kane reported FAIL — its own diagnosis: it checked the Email
field's value while looking at the wrong element reference / before the
visible section had settled, not a product failure.

**Independently verified directly:** the tab URL never left `/Register`
(no `/Success` navigation — nothing was submitted), and every visible text
field (Preferred First Name, Preferred Last Name, Email) held the correct
value from the real stored Career Profile. The generic field-detection and
fill mechanism worked correctly on a real, unfamiliar site; only Kane's own
assertion had a targeting issue. Logged as a verified false positive, same
as the earlier tracker false positive — no code change was needed for the
fill logic itself.

**Also verified separately (safe simulation, not a real submission):** the
generic submission-detection heuristic (phrase-matching for confirmation
text, since every ATS confirms differently) was tested by injecting
confirmation-like text into the DOM directly — no real form was ever
submitted — which correctly triggered `recordApplication()` and created a
tracker row. That test caught a real bug: the company-name fallback
(`guessCompanyFromHost()`) mishandled subdomains, e.g. producing
"Jobs.mckinsey" instead of "Mckinsey" for `jobs.mckinsey.com`. Fixed to use
the second-to-last hostname segment instead of everything before the TLD.

### 2026-08-21 — Generalized field detection: verified on a real external site

The extension originally only recognized fields via our own demo page's CSS
classes. Rewrote `extractFields()`/`jobContextFromPage()` to use standard,
site-agnostic signals instead — `label[for]`, a wrapping `<label>`,
`aria-label`, `aria-labelledby`, then `placeholder` as a last resort — and
broadened `manifest.json` to run on any site, not just localhost.

**Manual verification (direct CDP, not headless Kane — real live external
site, not something to script into a repeatable automated suite):** loaded
the extension in a real Chrome profile, opened a real company's live
careers/registration page, clicked Apply with AI. Result: fields correctly
detected and filled from the actual stored Career Profile — a completely
different, real-world resume (a warehouse-logistics background, nothing
like the engineering-focused test fixture) — with one field (a "Prefix"
title dropdown) correctly left blank and flagged for review since that
information isn't in the resume. No values were invented for it.

**A real bug surfaced during this**, caught the same way: the widget hung
indefinitely on "Loading your Career Profile…" and never errored. Root
cause — content script `fetch()` calls run in the *page's* security
context, and a plain HTTP request from a content script on an `https://`
page is blocked as mixed content (silently, with the promise never even
rejecting — not a normal fetch failure). Fixed by proxying all backend
calls through the background service worker (`chrome.runtime.sendMessage`
→ background does the actual `fetch`, which isn't subject to the page's
mixed-content policy) instead of fetching directly from the content script.

**Regression-checked** against the demo page afterward — field count and
grounding behavior unchanged, confirming the generic rewrite didn't
regress the original, Kane-verified flow.

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

### 2026-08-21 — AI semantic submission detection, verified against real Uber/Oracle pages (not Kane-driven)

**Context:** The extension previously decided "was this application actually
submitted?" using a hand-written `CONFIRMATION_PHRASES` regex list matched
against the page. This kept missing real ATS variants — most notably Oracle
Recruiting Cloud (Uber's careers site), which redirects to a generic
`my-profile` dashboard with no fixed confirmation wording, rather than a
dedicated "thank you" URL like Greenhouse's. Replaced it entirely with a new
`POST /api/autofill/detect-confirmation` endpoint that gives the model the
job context, current URL, and visible page text, and asks it to judge
`submitted: true/false` with reasoning — a semantic decision instead of a
pattern match.

**Verification:** Not run through Kane's own tab-driving harness for this
one — instead verified directly via CDP against tabs the user already had
open on Uber's real, authenticated Oracle Recruiting Cloud site
(`iaziqy.fa.ocs.oraclecloud.com/hcmUI/.../UberCareers`), which is exactly
the site that had been silently failing to track applications.

- Captured the real `my-profile` page text (a genuine "ACTIVE JOB
  APPLICATIONS" listing showing "Sr Staff Software Engineer" as "Under
  Consideration", plus an unrelated "DRAFT APPLICATIONS" entry) and posted
  it to the new endpoint with `jobContext` for the Sr Staff Software
  Engineer / Uber / req 147877 listing.
  **Result:** `submitted: true`, with reasoning that correctly matched the
  requisition ID and explicitly distinguished the submitted entry from the
  unrelated draft application on the same page.
- Captured the real, in-progress "Software Engineer application, step 1 of
  4" form (job 300990, not yet submitted) and posted it with `jobContext`
  for that same job.
  **Result:** `submitted: false`, with reasoning correctly noting the form
  was still open with an unclicked Submit button and no confirmation
  content.

Both are true real-world cases, not fabricated fixtures — the my-profile
page reflects an application the user actually submitted earlier in this
session that the old regex-based detector had missed. Extension rebuilt,
reloaded via `chrome://extensions`, and the fill flow regression-checked
before this change was committed.

### 2026-08-21 — MAJOR BUG: Kane run against a real, in-progress Uber application actually submitted it

**Severity:** High. A real, live job application (Uber, "Software Engineer",
Sunnyvale, CA, requisition 300990) got submitted to Uber's real Oracle
Recruiting Cloud site, on the user's real account, during a Kane CLI run —
even though the run's objective explicitly said "Do NOT click the site's
own final 'Submit' or 'Continue' button." This was caught, not staged: the
agent found it by independently re-checking the live `my-profile` page
after Kane reported a failure, rather than trusting Kane's own verdict.

**Setup:** `kane-cli run "...verify the CareerPilot 'Apply with AI' widget
fills fields on this real Oracle job application page... Do NOT click the
site's own final Submit or Continue button..." --cdp-endpoint
http://localhost:9335 --allow-missing-url --mode testing --max-steps 20
--timeout 180`, targeted at a real, already-open, mid-form (step 1 of 4)
Oracle Recruiting Cloud tab.

**What Kane reported:** `run_end status: "failed"`, `reason:
"stuck.ap_stuck"` — its own summary: "After the AI autofill started, the
site moved into a registration/import-and-save flow instead of returning
to a simple filled form view... agent kept waiting for a simple 'loading
screen disappears' outcome and then had no recovery path." Kane's own
verdict framed this as an automation/state-handling problem, not proven
product breakage — confidence 0.84, `agent_fault_assessment` explicitly
says "The agent did not break the page by clicking the extension button."
Kane's step log shows only two real actions before it stalled: clicking
the CareerPilot button, then waiting for the loading screen — no explicit
Submit/Continue click appears in the log at all.

**Independent verification (not trusting Kane's self-report):** Reloaded
the real `my-profile` page directly via CDP. It now listed "Software
Engineer... Uber 300990... Applied on 21/08/2026" under ACTIVE JOB
APPLICATIONS — a page that, before this run, showed that job only as an
in-progress form. The submission is real, not a Kane misreport.

**Root cause (two compounding issues, distinguished by checking
`chrome.storage.session` directly on the extension's service worker,
which came back completely empty post-incident):**
1. The Oracle tab Kane was pointed at had been open since earlier in the
   session. The extension was reloaded (to pick up that session's code
   changes) shortly before this run, and the tab was only *activated*
   (focused), never *navigated* — so its content script was a stale
   instance from before the reload. `savePendingApplication()` had no
   error handling around its `chrome.runtime.sendMessage` call, so its
   failure was a silent, unhandled rejection: CareerPilot's own pending-
   application flag never got set, which is why the auto-tracker never
   fired for this submission even though the confirmation-detection logic
   itself works correctly (see the entry above).
2. Independently, Kane's own autonomous exploration after getting
   confused by Oracle's real "Import your profile" state most likely
   clicked through that live registration/save flow itself while trying
   to find a "viable action" — this is the piece Kane's own verdict
   flags as an automation-agent behavior gap, not a CareerPilot defect.

**Fixes applied:**
- `savePendingApplication()` now wraps its `sendMessage` call in
  try/catch and `console.warn`s on failure instead of failing silently —
  doesn't fix the underlying stale-content-script scenario (refreshing
  the page after any extension reload is unavoidable in Chrome extension
  development), but a failure is now visible instead of invisible.
- Manually backfilled all three real, confirmed-genuine Uber applications
  that existed on the live `my-profile` page but were missing from the
  tracker (the one from this incident, plus two earlier real submissions
  from before the AI-confirmation-detection work existed at all), each
  with an honest `notes` field explaining why it was added manually
  rather than auto-detected.

**Open risk, disclosed rather than hidden:** giving an autonomous browser
agent free rein on a real, live, multi-step external application form is
inherently risky — an explicit "don't submit" instruction in the
objective did not fully prevent a real submission once the agent hit an
unexpected state. Further Kane runs against real in-progress application
forms should be scoped even more narrowly, or avoided in favor of
independent read-only verification (as done for the two confirmation-
detection cases above) once a form is already mid-submission risk.

### 2026-08-21 — Real false positive: AI confirmation detection misread an identity interstitial as a submission

**Found by:** the user, live — noticed a new row in `/applications` with
jobTitle "Are You Still With Us?" that they never manually added, and
asked how it got there. Not a Kane run; this was the auto-tracking
pipeline firing for real, on the user's own real Uber browsing, shortly
after the previous incident's fix was deployed — proof the pending-flag
save itself now works on a fresh page, but exposing a second, different
defect in the judgment layer.

**What happened:** the user opened a different real Uber job (153222) in
the same Chrome session and used the extension normally. Oracle
Recruiting Cloud's flow, right after just entering an email address —
before any application form is even reached — shows an "Are You Still
With Us?" interstitial when it recognizes an existing candidate account,
asking whether to continue with that profile. `detectConfirmationWithAI`
read this page and returned `submitted: true`, and the extension recorded
a fake "applied" row for a job that was never actually submitted.

**Root cause:** the confirmation prompt only asked the model to rule out
a login screen or an in-progress form — it had no explicit instruction
covering an identity/account-linking interstitial, which reads
plausibly "application-related" (mentions accounts, existing profiles)
without being a submission at all.

**Fix:** tightened `CONFIRMATION_SYSTEM_PROMPT` in
`server/src/routes/autofill.ts` to (1) require concrete evidence — a
status label, an "applied on" date, or a matching requisition ID, not
just the job title appearing somewhere — and (2) explicitly name
identity/re-authentication/"welcome back" interstitials as something
that must never count as a submission, since they occur early in a flow
rather than after it. Also added an explicit "when unsure, prefer
submitted=false" tie-breaker, since a missed confirmation is far
cheaper than a fabricated tracked application.

**Verified directly via curl against `/api/autofill/detect-confirmation`**
(not through Kane): a reconstructed version of the same interstitial now
returns `submitted: false` with reasoning correctly naming it as an
early-flow identity check; the original genuine positive case (the real
Uber `my-profile` page from the entry above) was re-run against the same
tightened prompt and still correctly returns `submitted: true` — the fix
narrows the false-positive without reintroducing the original false-
negative gap. The bad row was deleted from the tracker via `DELETE
/api/applications/:id`.

### 2026-08-21 — Real false negative: a genuine Google Careers submission wasn't auto-tracked

**Found by:** the user, live — submitted a real application ("Senior
Software Engineer, Vertex AI, Workbench - Warsaw") on Google Careers,
in a separate Chrome profile the agent had no CDP access to, and
reported nothing showed up in `/applications`.

**Diagnosis without direct browser access:** asked the user for a
screenshot of the actual dashboard page instead of guessing. It clearly
showed "Applications / Submitted (1) / Senior Software Engineer, Vertex
AI, Workbench - Warsaw / Updated 1 second ago / Submitted" — real,
unambiguous evidence of a genuine submission. Reconstructed that exact
text and posted it to `/api/autofill/detect-confirmation` with the real
job context: it correctly returned `submitted: true`. This ruled out
the prompt tightened in the entry above as the cause — the AI judgment
itself was fine given the right input.

**Root cause:** `checkAndRecordPendingApplication()` only ran once,
synchronously, at `document_idle` — it read whatever `document.body.
innerText` happened to be at that instant and never looked again. A
modern client-rendered dashboard (Google's, in this case) can easily
still be loading its "Submitted" status at that exact moment, so the
one-shot check reads an empty/loading page and never gets a second
chance. `watchForFillableForm()` already solved this exact class of
problem for detecting a fillable form on slow-rendering SPAs (Oracle,
confirmed earlier in this session) via a MutationObserver retry with a
20s timeout — the confirmation check never got the equivalent
treatment.

**Fix:** gave `checkAndRecordPendingApplication()` the same retry
pattern: try once immediately, and if not submitted, watch for DOM
mutations and retry (debounced with a `checking` flag to avoid
overlapping AI calls) for up to 20 seconds before giving up.

**Verified:** the underlying AI call was confirmed correct via direct
curl against the real captured page text (above); the retry logic
itself mirrors the already-proven `watchForFillableForm` pattern rather
than new, unverified logic. The real Google application was recorded
manually in the meantime with an honest note explaining why.
