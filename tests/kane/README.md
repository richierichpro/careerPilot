# Kane CLI Verification Log

This file documents real Kane CLI runs against CareerPilot — what was tested,
the result, and (when Kane catches something) how the agent responded.

No verification flows exist yet. They will be added once there is a real
end-to-end path to exercise (starting around the demo job application and
extension autofill milestones).

## Runs

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
