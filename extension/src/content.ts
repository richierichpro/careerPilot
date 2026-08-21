import type {
  AutofillResponse,
  CareerProfile,
  DetectedField,
  DetectedFieldType,
} from "@careerpilot/shared";

const SERVER_URL = "http://localhost:8787";

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface ExtractedField {
  field: DetectedField;
  element: FormControl;
}

function extractFields(): ExtractedField[] {
  const fieldEls = Array.from(document.querySelectorAll<HTMLElement>(".njob-field"));
  const results: ExtractedField[] = [];

  fieldEls.forEach((el, i) => {
    const labelEl = el.querySelector(".njob-label");
    const control = el.querySelector<FormControl>("input, select, textarea");
    if (!labelEl || !control) return;

    const label = (labelEl.textContent ?? "").replace("*", "").trim();
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
  const match = Array.from(el.options).find(
    (o) => o.value.toLowerCase() === target || o.textContent?.trim().toLowerCase() === target,
  );
  if (!match) return false;
  setNativeValue(el, match.value);
  return true;
}

function jobContextFromPage() {
  const title = document.querySelector(".njob-job-header h1")?.textContent?.trim() ?? document.title;
  const logo = document.querySelector(".njob-logo")?.textContent?.trim() ?? "";
  const description = document.querySelector(".njob-description")?.textContent?.trim();
  return {
    url: window.location.href,
    title,
    company: logo || "Unknown company",
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

    const extracted = extractFields();
    if (extracted.length === 0) {
      this.setPanel(`<div class="cp-status cp-error">No form fields found on this page.</div>`);
      this.button.disabled = false;
      return;
    }

    this.setPanel(`<div class="cp-status">Loading your Career Profile…</div>`);
    let profile: CareerProfile;
    try {
      const profileRes = await fetch(`${SERVER_URL}/api/profile/latest`);
      if (!profileRes.ok) {
        throw new Error(
          "No Career Profile found. Upload your resume on the CareerPilot onboarding page first.",
        );
      }
      profile = (await profileRes.json()) as CareerProfile;
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
      const res = await fetch(`${SERVER_URL}/api/autofill/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: profile.id,
          jobContext: this.lastJobContext,
          fields: extracted.map((e) => e.field),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Autofill generation failed.");
      }
      const data = (await res.json()) as AutofillResponse;
      answers = data.answers;
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
    `);
    this.button.disabled = false;
  }

  private watchForSubmission() {
    const observer = new MutationObserver(() => {
      const confirmation = document.querySelector(".njob-confirmation");
      if (confirmation) {
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
      const res = await fetch(`${SERVER_URL}/api/applications`, {
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
`;

new ApplyWidget();
