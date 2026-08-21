import type {
  AutofillResponse,
  CareerProfile,
  DetectedField,
  DetectedFieldType,
} from "@careerpilot/shared";

// Proxied through the background service worker — see background.ts for
// why a direct fetch() from here doesn't work on https:// pages.
async function bgFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  return chrome.runtime.sendMessage({ type: "CAREERPILOT_FETCH", path, init });
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface CheckboxOption {
  label: string;
  input: HTMLInputElement;
}

interface ExtractedField {
  field: DetectedField;
  // A single control for text/select/textarea fields, or null for a
  // checkbox-group field, which acts on checkboxOptions instead — a group
  // of same-name checkboxes/radios doesn't have one element to fill.
  element: FormControl | null;
  checkboxOptions?: CheckboxOption[];
}

const SKIPPED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "file",
  "password", // handled separately by fillPasswordFields — never sent to the AI or our server
  "image",
  "checkbox",
  "radio",
]);

// Generated and filled entirely client-side — never sent to our backend.
// Persistence relies on Chrome's own (already encrypted, already trusted)
// password manager rather than us building a credential store under time
// pressure, which is exactly the kind of thing that's easy to get wrong.
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = upper + lower + digits + symbols;
  const randomChar = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];

  const required = [randomChar(upper), randomChar(lower), randomChar(digits), randomChar(symbols)];
  const rest = Array.from({ length: 12 }, () => randomChar(all));
  const chars = [...required, ...rest];

  // Fisher-Yates, using crypto randomness rather than Math.random
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function fillPasswordFields(): string | null {
  const passwordInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((el) => isVisible(el) && el.value.trim().length === 0);

  if (passwordInputs.length === 0) return null;

  const password = generatePassword();
  for (const el of passwordInputs) {
    el.setAttribute("autocomplete", "new-password");
    setNativeValue(el, password);
  }
  return password;
}

function isVisible(el: HTMLElement): boolean {
  return !!el.offsetParent || el.getClientRects().length > 0;
}

const HONEYPOT_KEYWORDS = /honey ?pot|hp[-_]?field|bot[-_]?trap|do[-_]?not[-_]?fill/i;

// Anti-bot honeypot fields (confirmed real example: a field literally
// named "honey-pot" on an Oracle Recruiting Cloud application) are
// deliberately left in normal layout flow — hidden from human eyes via
// CSS (near-zero size, transparent) rather than display:none — so a
// naive automated fill that only checks offsetParent/getClientRects()
// still sees them as "visible" and fills them, which is exactly the
// signal these traps are designed to catch. A filled honeypot commonly
// gets a submission silently rejected or flagged as bot activity.
function isLikelyHoneypot(el: HTMLElement): boolean {
  const identity = `${el.id} ${el.getAttribute("name") ?? ""} ${el.className}`;
  if (HONEYPOT_KEYWORDS.test(identity)) return true;

  const rect = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const tinyOrTransparent =
    (rect.width <= 2 && rect.height <= 2) || parseFloat(cs.opacity) === 0 || cs.visibility === "hidden";
  return tinyOrTransparent && rect.width + rect.height > 0; // still "visible" per isVisible(), just deliberately disguised
}

// Real ATS platforms (Greenhouse, Lever, Workday, a company's own custom
// form, ...) all mark up labels differently. Try the standard/accessible
// approaches first, in priority order, before falling back to weaker
// signals — this is the part that has to work generically, unlike the
// page-specific selectors this used to hardcode.
function labelFor(control: FormControl): string | null {
  if (control.id) {
    const byFor = document.querySelector(`label[for="${CSS.escape(control.id)}"]`);
    if (byFor?.textContent?.trim()) return byFor.textContent;
  }

  const wrapping = control.closest("label");
  if (wrapping?.textContent?.trim()) return wrapping.textContent;

  const ariaLabel = control.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel;

  const labelledBy = control.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  const placeholder = control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement
    ? control.placeholder
    : null;
  if (placeholder?.trim()) return placeholder;

  return null;
}

function extractFields(): ExtractedField[] {
  const controls = Array.from(
    document.querySelectorAll<FormControl>("input, select, textarea"),
  ).filter((el) => {
    if (el instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.has(el.type)) return false;
    if (!isVisible(el)) return false;
    if (isLikelyHoneypot(el)) return false;
    if ("value" in el && el.value.trim().length > 0) return false; // don't clobber prefilled data
    return true;
  });

  const results: ExtractedField[] = [];

  controls.forEach((control, i) => {
    const rawLabel = labelFor(control);
    if (!rawLabel) return;
    const label = rawLabel.replace("*", "").trim();
    if (!label) return;

    let fieldType: DetectedFieldType = "text";
    let options: string[] | undefined;

    if (control.tagName === "TEXTAREA") {
      fieldType = "textarea";
    } else if (control.tagName === "SELECT") {
      fieldType = "select";
      options = Array.from((control as HTMLSelectElement).options)
        .map((o) => o.value)
        .filter(Boolean);
    } else if (control instanceof HTMLInputElement) {
      if (control.type === "email") fieldType = "email";
      else if (control.type === "tel") fieldType = "tel";
    }

    results.push({
      field: { id: `field-${i}`, label, fieldType, options },
      element: control,
    });
  });

  results.push(...extractCheckboxGroups(results.length));

  return results.slice(0, 40); // guard against pathological pages
}

// Checkboxes/radios sharing a name are one logical question with multiple
// selectable options (e.g. "which countries do you anticipate working in?"
// as 30 individual checkboxes) — not a field to type into. The standard,
// broadly-supported accessible pattern for this is <fieldset><legend>
// question</legend><label><input type=checkbox>...</fieldset>, so grouping
// by the nearest fieldset (rather than guessing at name-attribute parsing,
// which varies a lot across ATS platforms) generalizes reasonably well.
function extractCheckboxGroups(startIndex: number): ExtractedField[] {
  const seenFieldsets = new Set<HTMLFieldSetElement>();
  const results: ExtractedField[] = [];

  const groupInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]'),
  ).filter((el) => isVisible(el) && !isLikelyHoneypot(el));

  groupInputs.forEach((input, i) => {
    const fieldset = input.closest("fieldset");
    if (!fieldset || seenFieldsets.has(fieldset)) return;
    seenFieldsets.add(fieldset);

    const questionText = fieldset.querySelector("legend")?.textContent?.replace("*", "").trim();
    if (!questionText) return; // can't tell what's being asked — skip rather than guess

    const optionInputs = Array.from(
      fieldset.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]'),
    ).filter((el) => isVisible(el) && !isLikelyHoneypot(el));

    if (optionInputs.some((o) => o.checked)) return; // already answered — don't touch it

    const checkboxOptions: CheckboxOption[] = optionInputs
      .map((optEl) => {
        const optLabel = labelFor(optEl)?.trim();
        return optLabel ? { label: optLabel, input: optEl } : null;
      })
      .filter((x): x is CheckboxOption => x !== null);

    if (checkboxOptions.length === 0) return;

    results.push({
      field: {
        id: `field-${startIndex + i}`,
        label: questionText,
        fieldType: "checkbox-group",
        options: checkboxOptions.map((o) => o.label),
      },
      element: null,
      checkboxOptions,
    });
  });

  return results;
}

// React tracks a shadow "last value" on the native setter, so plain
// `el.value = x` is silently ignored by React's onChange. Using the
// prototype's native setter directly, then dispatching a real event,
// is the standard workaround to make a controlled input notice a
// programmatic change.
function setNativeValue(el: FormControl, value: string) {
  const proto =
    el.tagName === "SELECT"
      ? window.HTMLSelectElement.prototype
      : el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  const eventType = el.tagName === "SELECT" ? "change" : "input";
  el.dispatchEvent(new Event(eventType, { bubbles: true }));
}

function fillSelect(el: HTMLSelectElement, desired: string): boolean {
  const target = desired.trim().toLowerCase();
  const options = Array.from(el.options);
  const exact = options.find(
    (o) => o.value.toLowerCase() === target || o.textContent?.trim().toLowerCase() === target,
  );
  const match =
    exact ??
    options.find((o) => o.textContent?.trim().toLowerCase().includes(target)) ??
    options.find((o) => target.includes(o.textContent?.trim().toLowerCase() ?? " "));
  if (!match) return false;
  setNativeValue(el, match.value);
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isComboboxInput(el: HTMLInputElement): boolean {
  return (
    el.getAttribute("role") === "combobox" ||
    el.hasAttribute("aria-autocomplete") ||
    el.hasAttribute("aria-expanded") ||
    el.hasAttribute("aria-controls")
  );
}

// "University", "Company", "School" and similar fields on real ATS forms
// are very often a type-to-search combobox, not a plain text input: you
// type a few letters, the site fetches matching results, and you have to
// CLICK one for the selection to actually register in the site's own
// state — setting .value alone leaves text visible but nothing truly
// selected, which fails validation on submit even though the field looks
// filled. This dispatches real keystroke-shaped events so the site's own
// search fires, waits for a results listbox to render, and clicks the
// best match — falling back to plain text only if the field never opens
// any popup at all (i.e. it genuinely isn't a combobox).
function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/[-\s]+/g, " ");
}

const SCHOOL_SEARCH_STOPWORDS = new Set([
  "university", "college", "institute", "school", "the", "of", "at", "and",
  "state", "technical", "community",
]);

// Real ATS school/company databases often format names differently from a
// natural-language AI answer (dashes vs spaces, abbreviations, campus
// suffixes) — e.g. "University of Illinois Urbana-Champaign" vs the
// database's "University of Illinois - Urbana-Champaign". Retrying with
// just the most distinctive word is a cheap way to recover from that.
function mostDistinctiveWord(value: string): string | null {
  const candidates = value
    .split(/[\s,-]+/)
    .filter((w) => w.length > 2 && !SCHOOL_SEARCH_STOPWORDS.has(w.toLowerCase()));
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.length > a.length ? b : a));
}

async function searchComboboxOptions(el: HTMLInputElement, query: string): Promise<HTMLElement[]> {
  setNativeValue(el, query);
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  await sleep(600); // let the site's async search/filter respond

  const listboxId = el.getAttribute("aria-controls");
  const scope = listboxId ? document.getElementById(listboxId) : document;
  return Array.from((scope ?? document).querySelectorAll<HTMLElement>('[role="option"]')).filter(
    isVisible,
  );
}

function findBestOption(options: HTMLElement[], target: string): HTMLElement | undefined {
  const norm = normalizeForMatch(target);
  return (
    options.find((o) => normalizeForMatch(o.textContent ?? "") === norm) ??
    options.find((o) => normalizeForMatch(o.textContent ?? "").includes(norm)) ??
    options.find((o) => norm.includes(normalizeForMatch(o.textContent ?? " ")))
  );
}

async function fillComboboxInput(el: HTMLInputElement, value: string): Promise<boolean> {
  let options = await searchComboboxOptions(el, value);
  const popupOpened = el.getAttribute("aria-expanded") === "true" || options.length > 0;

  if (!popupOpened) {
    // Typing never opened any popup at all — this isn't actually a
    // search-driven combobox, just keep the typed text as a plain field.
    return true;
  }

  let best = findBestOption(options, value);

  if (!best) {
    // Exact/normalized phrasing didn't match anything — try again with
    // just the most distinctive word, then re-match against the full
    // original value among those results.
    const keyword = mostDistinctiveWord(value);
    if (keyword) {
      options = await searchComboboxOptions(el, keyword);
      best = findBestOption(options, value);
    }
  }

  if (!best) {
    // A popup genuinely opened but nothing matched what we typed —
    // clicking an unrelated option would be worse than leaving it blank.
    // Clear the typed text (it isn't a valid selection either way) and
    // let the caller flag this field for the user to fill in themselves.
    setNativeValue(el, "");
    return false;
  }

  best.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  best.click();
  await sleep(150);
  return true;
}

function guessCompanyFromHost(): string {
  // "jobs.mckinsey.com" -> "mckinsey", not "jobs.mckinsey" — the
  // registrable domain label is the one right before the TLD, so drop
  // every other subdomain (jobs., careers., boards., www., ...) too.
  const parts = window.location.hostname.split(".");
  const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// Greenhouse's embedded application widget lives at
// job-boards.greenhouse.io/{company-slug}/jobs/{id} — the real company
// slug is right there in the iframe's own URL path, which matters because
// jobContextFromPage() often runs *inside* that iframe (the form lives
// there, not on the parent company page), where og:site_name and other
// page-identity signals belong to greenhouse.io, not the real employer.
function guessCompanyFromGreenhouseUrl(): string | null {
  if (!/(^|\.)greenhouse\.io$/.test(window.location.hostname)) return null;

  // Two real URL shapes: /{company-slug}/jobs/{id} (direct board), and
  // /embed/job_app?for={company-slug}&token={id} (the embed widget most
  // companies actually use on their own careers page) — the "embed"
  // path segment itself is never the company, only the first form's
  // /company/jobs/ pattern is, so the query param has to come first.
  const slug =
    new URLSearchParams(window.location.search).get("for") ||
    window.location.pathname.split("/").filter((s) => s && s !== "embed")[0];
  if (!slug) return null;

  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function jobContextFromPage() {
  // Prefer our own demo page's known structure (exact, already verified),
  // then fall back to generic signals that work on an arbitrary real site.
  const title =
    document.querySelector(".njob-job-header h1")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    document.title;

  const company =
    document.querySelector(".njob-logo")?.textContent?.trim() ||
    document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim() ||
    guessCompanyFromGreenhouseUrl() ||
    guessCompanyFromHost();

  const description =
    document.querySelector(".njob-description")?.textContent?.trim() ||
    document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();

  return {
    url: window.location.href,
    title,
    company,
    description,
  };
}

type JobContext = ReturnType<typeof jobContextFromPage>;

// Many real ATS platforms (Greenhouse included) navigate to a genuinely
// new URL on submit — e.g. .../jobs/123 -> .../jobs/123/confirmation —
// rather than swapping content in place on the same page. A real
// navigation destroys this script's whole JS context, so an in-memory
// "we just submitted" flag or a same-page MutationObserver can never see
// it. chrome.storage.session survives across navigations within the same
// browser session (but not permanently — cleared on browser restart),
// which is exactly the right lifetime for "remember this across the next
// page load, but don't leak it into some unrelated future session."
async function savePendingApplication(jobContext: JobContext): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "CAREERPILOT_SAVE_PENDING", jobContext });
  } catch (err) {
    // Silent failure here (e.g. an orphaned content script after an
    // extension reload, or the background worker being unreachable) used to
    // mean this application would never get auto-tracked, with zero signal
    // that anything went wrong. Surfacing it at least makes the failure
    // visible in the page console instead of invisible.
    console.warn("CareerPilot: could not save pending-application flag — auto-tracking for this application may not fire.", err);
  }
}

// Regex-based "does this look like a confirmation" heuristics kept
// breaking on real sites — every ATS platform lands somewhere different
// after a real submit (a dedicated thank-you page, a candidate dashboard
// buried under an unrelated URL, different wording every time), and each
// fix was another narrow pattern added after the fact. Asking Claude to
// actually read the page and decide generalizes far better than another
// regex would.
async function detectConfirmationWithAI(jobContext: JobContext): Promise<boolean> {
  try {
    const res = await bgFetch("/api/autofill/detect-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobContext,
        currentUrl: window.location.href,
        pageText: document.body.innerText.slice(0, 4000),
      }),
    });
    if (!res.ok) return false;
    const { submitted } = res.body as { submitted: boolean; reasoning: string };
    return submitted;
  } catch {
    return false;
  }
}

// Fields the AI couldn't ground (e.g. pronouns, gender) get flagged for the
// candidate to fill in by hand. When they do, that answer is worth more than
// this one form — save it back to the profile so the next application never
// asks again.
async function learnAnswer(profileId: string, label: string, value: string): Promise<boolean> {
  try {
    const res = await bgFetch(`/api/profile/${profileId}/learn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Automatic detection (immediate check + a MutationObserver retry window)
// depends on timing heuristics that have real, demonstrated failure modes —
// a slow-rendering dashboard can still be loading when even the retry
// window gives up. Rather than chase every ATS's specific render timing,
// give the candidate a guaranteed, one-click way to trigger the exact same
// AI check themselves the moment they can actually see a "Submitted" status
// on screen — a human looking at the real page is a more reliable signal
// than any more timing logic could be. Returns the host element so the
// caller can remove it once resolved (by either path).
function showPendingChecker(jobContext: JobContext, onCheck: () => Promise<boolean>): HTMLDivElement {
  const host = document.createElement("div");
  host.id = "careerpilot-pending-checker-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .cp-checker {
      position: fixed; bottom: 24px; left: 20px; z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #fff; color: #17181c; border: 1px solid #d1d5db;
      border-radius: 999px; box-shadow: 0 4px 14px rgba(0,0,0,0.15);
      padding: 0.55rem 1rem; font-size: 0.82rem; font-weight: 500;
      cursor: pointer;
    }
    .cp-checker:hover { background: #f8fafc; }
    .cp-checker.busy { opacity: 0.6; cursor: default; }
  `;
  shadow.appendChild(style);
  const label = `Applied to ${jobContext.company}? Check this page`;
  const btn = document.createElement("button");
  btn.className = "cp-checker";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (btn.classList.contains("busy")) return;
    btn.classList.add("busy");
    btn.textContent = "Checking…";
    void onCheck().then((done) => {
      if (done) {
        host.remove();
        return;
      }
      btn.classList.remove("busy");
      btn.textContent = label;
    });
  });
  shadow.appendChild(btn);
  return host;
}

async function recordApplicationToServer(ctx: JobContext): Promise<boolean> {
  try {
    const res = await bgFetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: ctx.company,
        jobTitle: ctx.title,
        jobUrl: ctx.url,
        status: "applied",
        source: "CareerPilot extension",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Runs unconditionally on every page load, independent of whether the
// Apply with AI widget mounts here — a dedicated "thank you" confirmation
// page typically has no form fields of its own, so the widget wouldn't
// appear there at all, but that's exactly the page this needs to detect.
// Regex-based "does this look like a confirmation" heuristics kept
// breaking on real sites — every ATS platform lands somewhere different
// after a real submit (a dedicated thank-you page, a candidate dashboard
// buried under an unrelated URL, different wording every time), and each
// fix was another narrow pattern added after the fact. Asking Claude to
// actually read the page and decide generalizes far better than another
// regex would. Gated the same way the old heuristic was — only runs at
// all when a recent (< 30 min) "Apply with AI" click left a pending
// flag — so this never fires on an unprompted page visit.
async function checkAndRecordPendingApplication(): Promise<void> {
  const { jobContext } = (await chrome.runtime.sendMessage({ type: "CAREERPILOT_PEEK_PENDING" })) as {
    jobContext: JobContext | null;
  };
  if (!jobContext) return; // nothing pending, or it already expired

  const tryDetectAndRecord = async (): Promise<boolean> => {
    const submitted = await detectConfirmationWithAI(jobContext);
    if (!submitted) return false;

    // Clear before recording — if the record call fails, better to lose
    // one tracker entry than risk double-recording on a reload of this
    // same confirmation page.
    await chrome.runtime.sendMessage({ type: "CAREERPILOT_CLEAR_PENDING" });
    const ok = await recordApplicationToServer(jobContext);
    showToast(
      ok
        ? `✓ Application to ${jobContext.company} recorded in your CareerPilot tracker.`
        : `Application to ${jobContext.company} submitted, but couldn't be recorded in CareerPilot.`,
      ok ? "success" : "error",
    );
    return true;
  };

  // Always available immediately, not just as a last resort after the
  // automatic attempts below give up — a demonstrated real gap (a slow-
  // rendering dashboard's status not being in the DOM yet at any fixed
  // check time) means automatic detection alone isn't reliable enough on
  // its own to promise "you'll never need to check this yourself."
  let resolved = false;
  const checkerHost = showPendingChecker(jobContext, async () => {
    const done = await tryDetectAndRecord();
    if (done) resolved = true;
    return done;
  });

  if (await tryDetectAndRecord()) {
    resolved = true;
    checkerHost.remove();
    return;
  }

  // A landing dashboard on a real ATS (Google Careers confirmed) can still
  // be mid-render on this first check — its "Submitted" status may not be
  // in the DOM yet. Retry on DOM changes for a while instead of giving up
  // after one look, the same pattern watchForFillableForm already uses for
  // slow-rendering application forms.
  let checking = false;
  const observer = new MutationObserver(() => {
    if (checking || resolved) {
      if (resolved) observer.disconnect();
      return;
    }
    checking = true;
    void tryDetectAndRecord()
      .then((done) => {
        if (done) {
          resolved = true;
          observer.disconnect();
          checkerHost.remove();
        }
      })
      .finally(() => {
        checking = false;
      });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 20000);
}

class ApplyWidget {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private panel: HTMLDivElement;
  private button: HTMLButtonElement;
  // Captured while the job posting is still in the DOM — submission swaps
  // the page to a confirmation view that no longer has the job title, so
  // this must be read before that swap happens, not after.
  private lastJobContext: ReturnType<typeof jobContextFromPage> | null = null;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "careerpilot-widget-host";
    document.body.appendChild(this.host);
    this.shadow = this.host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = WIDGET_CSS;
    this.shadow.appendChild(style);

    this.panel = document.createElement("div");
    this.panel.className = "cp-panel";
    this.shadow.appendChild(this.panel);

    this.button = document.createElement("button");
    this.button.className = "cp-fab";
    this.button.textContent = "Apply with AI";
    this.button.addEventListener("click", () => void this.run());
    this.shadow.appendChild(this.button);

    this.watchForSubmission();
  }

  private setPanel(html: string) {
    this.panel.innerHTML = html;
    this.panel.classList.add("visible");
  }

  private async run() {
    this.button.disabled = true;
    this.setPanel(`<div class="cp-status">Reading the application form…</div>`);

    const generatedPassword = fillPasswordFields();
    const extracted = extractFields();

    if (extracted.length === 0 && !generatedPassword) {
      this.setPanel(`<div class="cp-status cp-error">No form fields found on this page.</div>`);
      this.button.disabled = false;
      return;
    }

    if (extracted.length === 0 && generatedPassword) {
      this.setPanel(this.passwordPanelHtml(generatedPassword));
      this.attachCopyPasswordHandler();
      this.button.disabled = false;
      return;
    }

    this.setPanel(`<div class="cp-status">Loading your Career Profile…</div>`);
    let profile: CareerProfile;
    try {
      const profileRes = await bgFetch("/api/profile/latest");
      if (!profileRes.ok) {
        throw new Error(
          "No Career Profile found. Upload your resume on the CareerPilot onboarding page first.",
        );
      }
      profile = profileRes.body as CareerProfile;
    } catch (err) {
      this.setPanel(
        `<div class="cp-status cp-error">${err instanceof Error ? err.message : "Could not load your Career Profile."}</div>`,
      );
      this.button.disabled = false;
      return;
    }

    this.setPanel(
      `<div class="cp-status">AI is answering ${extracted.length} field${extracted.length === 1 ? "" : "s"} from your profile…</div>`,
    );

    this.lastJobContext = jobContextFromPage();
    // Save immediately, before the AI call — if the user submits shortly
    // after and the site navigates to a real confirmation URL, this is
    // what survives that navigation to let it still get recorded.
    void savePendingApplication(this.lastJobContext);

    let answers: AutofillResponse["answers"];
    try {
      const res = await bgFetch("/api/autofill/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          jobContext: this.lastJobContext,
          fields: extracted.map((e) => e.field),
        }),
      });
      if (!res.ok) {
        const body = res.body as { error?: string } | null;
        throw new Error(body?.error ?? "Autofill generation failed.");
      }
      answers = (res.body as AutofillResponse).answers;
    } catch (err) {
      this.setPanel(
        `<div class="cp-status cp-error">${err instanceof Error ? err.message : "Autofill generation failed."}</div>`,
      );
      this.button.disabled = false;
      return;
    }

    let filled = 0;
    let needsReview = 0;
    const byId = new Map(extracted.map((e) => [e.field.id, e]));

    for (const answer of answers) {
      const entry = byId.get(answer.id);
      if (!entry) continue;

      if (entry.checkboxOptions) {
        if (!answer.grounded || !answer.value.trim()) {
          needsReview++;
          this.watchForLearnableCheckboxGroup(entry.checkboxOptions, entry.field.label, profile.id);
          continue;
        }
        const target = answer.value.trim().toLowerCase();
        const match =
          entry.checkboxOptions.find((o) => o.label.toLowerCase() === target) ??
          entry.checkboxOptions.find((o) => o.label.toLowerCase().includes(target)) ??
          entry.checkboxOptions.find((o) => target.includes(o.label.toLowerCase()));
        if (match) {
          match.input.click();
          filled++;
          match.input.style.outlineColor = "#2f6feb";
        } else {
          needsReview++;
        }
        continue;
      }

      const element = entry.element;
      if (!element) continue;

      if (!answer.grounded || !answer.value.trim()) {
        needsReview++;
        element.style.outline = "2px dashed #b45309";
        element.style.outlineOffset = "2px";
        element.title = "CareerPilot: not found in your profile — please fill this in yourself.";
        this.watchForLearnableAnswer(element, entry.field.label, profile.id);
        continue;
      }

      let ok: boolean;
      if (element.tagName === "SELECT") {
        ok = fillSelect(element as HTMLSelectElement, answer.value);
      } else if (element instanceof HTMLInputElement && isComboboxInput(element)) {
        this.setPanel(`<div class="cp-status">Searching "${answer.value}"…</div>`);
        ok = await fillComboboxInput(element, answer.value);
      } else {
        setNativeValue(element, answer.value);
        ok = true;
      }

      if (ok) {
        filled++;
        element.style.outline = "2px solid #2f6feb";
        element.style.outlineOffset = "2px";
        element.title = "Filled by CareerPilot AI — review before submitting.";
      } else {
        needsReview++;
        element.style.outline = "2px dashed #b45309";
        element.style.outlineOffset = "2px";
      }
    }

    this.setPanel(`
      <div class="cp-status cp-done">
        Filled ${filled} of ${extracted.length} fields.
        ${needsReview > 0 ? `<strong>${needsReview} need your review</strong> (dashed orange outline).` : "Review the highlighted fields, then submit."}
      </div>
      ${generatedPassword ? this.passwordNoteHtml(generatedPassword) : ""}
    `);
    this.attachCopyPasswordHandler();
    this.button.disabled = false;
  }

  // A field the AI couldn't ground is left for the candidate to fill by
  // hand. The first time they do (change or blur, whichever fires first —
  // both are removed together so it can only fire once), record it against
  // the profile so it's grounded truth on every future application.
  private watchForLearnableAnswer(element: FormControl, label: string, profileId: string) {
    const handler = () => {
      const value = element.value.trim();
      element.removeEventListener("change", handler);
      element.removeEventListener("blur", handler);
      if (!value) return;
      void learnAnswer(profileId, label, value).then((ok) => {
        if (ok) {
          element.style.outline = "2px solid #16a34a";
          element.title = "CareerPilot learned this answer — it'll auto-fill next time.";
        }
      });
    };
    element.addEventListener("change", handler);
    element.addEventListener("blur", handler);
  }

  private watchForLearnableCheckboxGroup(
    options: CheckboxOption[],
    label: string,
    profileId: string,
  ) {
    const handlers: Array<[HTMLInputElement, () => void]> = [];
    const cleanup = () => {
      for (const [input, h] of handlers) input.removeEventListener("change", h);
    };
    for (const opt of options) {
      const handler = () => {
        if (!opt.input.checked) return;
        cleanup();
        void learnAnswer(profileId, label, opt.label);
      };
      handlers.push([opt.input, handler]);
      opt.input.addEventListener("change", handler);
    }
  }

  private passwordPanelHtml(password: string): string {
    return `<div class="cp-status cp-done">Generated an account password.</div>${this.passwordNoteHtml(password)}`;
  }

  private passwordNoteHtml(password: string): string {
    return `
      <div class="cp-password-note">
        Password: <code>${password}</code>
        <button type="button" class="cp-copy-btn" data-password="${password}">Copy</button>
        <div class="muted">Chrome should offer to save this — if it doesn't, copy it now.</div>
      </div>
    `;
  }

  private attachCopyPasswordHandler() {
    this.panel.querySelector(".cp-copy-btn")?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      void navigator.clipboard.writeText(btn.dataset.password ?? "");
      btn.textContent = "Copied";
    });
  }

  // Real ATS platforms signal a successful submission very differently —
  // a redirect, a toast, a swapped-in "thank you" panel — with no single
  // reliable generic signal. Our own demo page gets an instant exact-match
  // fast path; every other site is judged by detectConfirmationWithAI,
  // which reads the swapped-in page content the same way a person would
  // rather than matching it against a fixed pattern.
  private watchForSubmission() {
    let checking = false;

    const observer = new MutationObserver(() => {
      // Exact match for our own demo page — instant, no need for an AI
      // round-trip on a page we already know precisely.
      if (document.querySelector(".njob-confirmation")) {
        observer.disconnect();
        void this.recordApplication();
        return;
      }

      if (!this.lastJobContext || checking) return;
      checking = true;
      void detectConfirmationWithAI(this.lastJobContext)
        .then((submitted) => {
          if (submitted) {
            observer.disconnect();
            void this.recordApplication();
          }
        })
        .finally(() => {
          checking = false;
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  private async recordApplication() {
    // Prefer the context captured while the job posting was still visible —
    // by now the page has swapped to a confirmation view that no longer has
    // the job title in it. Fall back to a fresh read only if the user
    // submitted without ever running Apply with AI.
    const ctx = this.lastJobContext ?? jobContextFromPage();
    await chrome.runtime.sendMessage({ type: "CAREERPILOT_CLEAR_PENDING" });
    const ok = await recordApplicationToServer(ctx);
    this.setPanel(
      ok
        ? `<div class="cp-status cp-done">✓ Recorded in your CareerPilot tracker.</div>`
        : `<div class="cp-status cp-error">Application submitted, but couldn't record it in CareerPilot.</div>`,
    );
    showToast(
      ok
        ? `✓ Application to ${ctx.company} recorded in your CareerPilot tracker.`
        : `Application to ${ctx.company} submitted, but couldn't be recorded in CareerPilot.`,
      ok ? "success" : "error",
    );
  }
}

const WIDGET_CSS = `
  :host { all: initial; }
  .cp-fab {
    position: fixed; top: 20px; right: 20px; z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #2f6feb; color: #fff; border: none; border-radius: 999px;
    padding: 0.75rem 1.4rem; font-size: 0.92rem; font-weight: 600;
    cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2);
  }
  .cp-fab:disabled { opacity: 0.6; cursor: default; }
  .cp-fab:hover:not(:disabled) { background: #2557c7; }
  .cp-panel {
    display: none; position: fixed; top: 74px; right: 20px; z-index: 2147483647;
    width: 280px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #fff; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.18);
    padding: 0.9rem 1rem; font-size: 0.85rem; line-height: 1.45; color: #17181c;
  }
  .cp-panel.visible { display: block; }
  .cp-status.cp-error { color: #991b1b; }
  .cp-status.cp-done { color: #166534; }
  .cp-password-note {
    margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px solid #eee;
    color: #17181c;
  }
  .cp-password-note code {
    background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 4px;
    font-size: 0.8rem;
  }
  .cp-copy-btn {
    margin-left: 0.4rem; font-size: 0.75rem; padding: 0.15rem 0.5rem;
    border-radius: 4px; border: 1px solid #d1d5db; background: #fff; cursor: pointer;
  }
  .cp-password-note .muted { color: #6b7280; font-size: 0.78rem; margin-top: 0.3rem; }
`;

// Confirmation is very often detected on a page that never mounts the
// ApplyWidget at all (a bare confirmation/dashboard page usually has no
// form fields), so "recorded" can't rely on the widget's own panel to tell
// the candidate what happened. This is a standalone, always-available
// notice, in its own shadow host so it survives regardless of whether a
// widget exists on this page.
function showToast(message: string, kind: "success" | "error" = "success") {
  const host = document.createElement("div");
  host.id = "careerpilot-toast-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    .cp-toast {
      position: fixed; bottom: 24px; right: 20px; z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #fff; color: #17181c; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2); padding: 0.85rem 1.1rem;
      font-size: 0.88rem; line-height: 1.4; max-width: 300px;
      border-left: 4px solid ${kind === "success" ? "#16a34a" : "#b45309"};
      animation: cp-toast-in 0.2s ease-out;
    }
    @keyframes cp-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `;
  shadow.appendChild(style);
  const toast = document.createElement("div");
  toast.className = "cp-toast";
  toast.textContent = message;
  shadow.appendChild(toast);
  setTimeout(() => host.remove(), 6000);
}

// With all_frames enabled (needed for iframe-embedded ATS forms — see
// below), this script runs in every frame on the page: trackers, ad
// iframes, reCAPTCHA, etc. Only mount the widget in a frame that actually
// looks like it has a form worth filling, and never on our own web app.
function frameHasFillableForm(): boolean {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input")).some(
    (el) => !SKIPPED_INPUT_TYPES.has(el.type),
  ) || document.querySelector("select, textarea") !== null;
}

// Real ATS integrations very commonly embed the actual application form in
// a cross-origin iframe (Greenhouse's job-boards.greenhouse.io embed widget
// behind a company's own careers page is the single most common example —
// the top-level page itself often has zero form fields). A content script
// only sees the frame it's injected into, so with all_frames: true in the
// manifest, this same script runs separately inside that iframe too, and
// mounts its own independent widget scoped to that frame's own form —
// extraction, autofill, and submission-detection all happen local to
// whichever frame actually holds the fields, no cross-frame messaging
// needed.
// Heavy SPA-based ATS platforms (Oracle Recruiting Cloud is a confirmed
// real example) render their actual form fields well after this script's
// one-shot document_idle injection point — a single frameHasFillableForm()
// check right away can run before the form exists at all. Retry on DOM
// mutations for a while instead of giving up after one look.
function watchForFillableForm() {
  if (document.querySelector(".app-shell")) return;

  if (frameHasFillableForm()) {
    new ApplyWidget();
    return;
  }

  const observer = new MutationObserver(() => {
    if (frameHasFillableForm()) {
      observer.disconnect();
      new ApplyWidget();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 20000); // give up rather than watch forever
}

watchForFillableForm();

// Independent of whether the widget mounts on THIS page — a confirmation
// page reached via a real navigation typically has no form fields at all,
// so the widget wouldn't appear here, but this still needs to run to catch
// exactly that page.
if (!document.querySelector(".app-shell")) {
  void checkAndRecordPendingApplication();
}
