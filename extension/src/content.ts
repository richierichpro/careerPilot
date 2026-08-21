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

interface ExtractedField {
  field: DetectedField;
  element: FormControl;
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

  return results.slice(0, 40); // guard against pathological pages
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
  const match = Array.from(el.options).find(
    (o) => o.value.toLowerCase() === target || o.textContent?.trim().toLowerCase() === target,
  );
  if (!match) return false;
  setNativeValue(el, match.value);
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
      const { element } = entry;

      if (!answer.grounded || !answer.value.trim()) {
        needsReview++;
        element.style.outline = "2px dashed #b45309";
        element.style.outlineOffset = "2px";
        element.title = "CareerPilot: not found in your profile — please fill this in yourself.";
        continue;
      }

      const ok =
        element.tagName === "SELECT"
          ? fillSelect(element as HTMLSelectElement, answer.value)
          : (setNativeValue(element, answer.value), true);

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
  // a redirect, a toast, a swapped-in "thank you" panel. There's no single
  // reliable generic signal, so this combines our own demo page's exact
  // marker with a best-effort phrase heuristic for other sites. It can
  // both miss real confirmations and false-positive on unrelated text —
  // it's a heuristic, not a guarantee, which is why the widget always
  // shows what it did rather than silently trusting this.
  private watchForSubmission() {
    const confirmationPhrases =
      /application (has been )?(submitted|received)|thank you for (applying|your application)|we('| ha)ve received your application/i;

    const observer = new MutationObserver(() => {
      if (document.querySelector(".njob-confirmation")) {
        observer.disconnect();
        void this.recordApplication();
        return;
      }
      if (this.lastJobContext && confirmationPhrases.test(document.body.innerText.slice(0, 4000))) {
        observer.disconnect();
        void this.recordApplication();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  private async recordApplication() {
    // Prefer the context captured while the job posting was still visible —
    // by now the page has swapped to a confirmation view that no longer has
    // the job title in it. Fall back to a fresh read only if the user
    // submitted without ever running Apply with AI.
    const ctx = this.lastJobContext ?? jobContextFromPage();
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
      if (!res.ok) throw new Error(`status ${res.status}`);
      this.setPanel(`<div class="cp-status cp-done">✓ Recorded in your CareerPilot tracker.</div>`);
    } catch {
      this.setPanel(
        `<div class="cp-status cp-error">Application submitted, but couldn't record it in CareerPilot.</div>`,
      );
    }
  }
}

const WIDGET_CSS = `
  :host { all: initial; }
  .cp-fab {
    position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #2f6feb; color: #fff; border: none; border-radius: 999px;
    padding: 0.75rem 1.4rem; font-size: 0.92rem; font-weight: 600;
    cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.2);
  }
  .cp-fab:disabled { opacity: 0.6; cursor: default; }
  .cp-fab:hover:not(:disabled) { background: #2557c7; }
  .cp-panel {
    display: none; position: fixed; bottom: 78px; right: 24px; z-index: 2147483647;
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

// Don't show the widget on our own web app — it has nothing to fill and
// would just be visual clutter on the onboarding/tracker pages.
if (!document.querySelector(".app-shell")) {
  new ApplyWidget();
}
