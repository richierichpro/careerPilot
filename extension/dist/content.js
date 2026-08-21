"use strict";
(() => {
  // src/content.ts
  async function bgFetch(path, init) {
    return chrome.runtime.sendMessage({ type: "CAREERPILOT_FETCH", path, init });
  }
  var SKIPPED_INPUT_TYPES = /* @__PURE__ */ new Set([
    "hidden",
    "submit",
    "button",
    "reset",
    "file",
    "password",
    // handled separately by fillPasswordFields — never sent to the AI or our server
    "image",
    "checkbox",
    "radio"
  ]);
  function generatePassword() {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnpqrstuvwxyz";
    const digits = "23456789";
    const symbols = "!@#$%^&*-_=+";
    const all = upper + lower + digits + symbols;
    const randomChar = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
    const required = [randomChar(upper), randomChar(lower), randomChar(digits), randomChar(symbols)];
    const rest = Array.from({ length: 12 }, () => randomChar(all));
    const chars = [...required, ...rest];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }
  function fillPasswordFields() {
    const passwordInputs = Array.from(
      document.querySelectorAll('input[type="password"]')
    ).filter((el) => isVisible(el) && el.value.trim().length === 0);
    if (passwordInputs.length === 0) return null;
    const password = generatePassword();
    for (const el of passwordInputs) {
      el.setAttribute("autocomplete", "new-password");
      setNativeValue(el, password);
    }
    return password;
  }
  function isVisible(el) {
    return !!el.offsetParent || el.getClientRects().length > 0;
  }
  var HONEYPOT_KEYWORDS = /honey ?pot|hp[-_]?field|bot[-_]?trap|do[-_]?not[-_]?fill/i;
  function isLikelyHoneypot(el) {
    const identity = `${el.id} ${el.getAttribute("name") ?? ""} ${el.className}`;
    if (HONEYPOT_KEYWORDS.test(identity)) return true;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const tinyOrTransparent = rect.width <= 2 && rect.height <= 2 || parseFloat(cs.opacity) === 0 || cs.visibility === "hidden";
    return tinyOrTransparent && rect.width + rect.height > 0;
  }
  function labelFor(control) {
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
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
      if (text) return text;
    }
    const placeholder = control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement ? control.placeholder : null;
    if (placeholder?.trim()) return placeholder;
    return null;
  }
  function extractFields() {
    const controls = Array.from(
      document.querySelectorAll("input, select, textarea")
    ).filter((el) => {
      if (el instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.has(el.type)) return false;
      if (!isVisible(el)) return false;
      if (isLikelyHoneypot(el)) return false;
      if ("value" in el && el.value.trim().length > 0) return false;
      return true;
    });
    const results = [];
    controls.forEach((control, i) => {
      const rawLabel = labelFor(control);
      if (!rawLabel) return;
      const label = rawLabel.replace("*", "").trim();
      if (!label) return;
      let fieldType = "text";
      let options;
      if (control.tagName === "TEXTAREA") {
        fieldType = "textarea";
      } else if (control.tagName === "SELECT") {
        fieldType = "select";
        options = Array.from(control.options).map((o) => o.value).filter(Boolean);
      } else if (control instanceof HTMLInputElement) {
        if (control.type === "email") fieldType = "email";
        else if (control.type === "tel") fieldType = "tel";
      }
      results.push({
        field: { id: `field-${i}`, label, fieldType, options },
        element: control
      });
    });
    results.push(...extractCheckboxGroups(results.length));
    return results.slice(0, 40);
  }
  function extractCheckboxGroups(startIndex) {
    const seenFieldsets = /* @__PURE__ */ new Set();
    const results = [];
    const groupInputs = Array.from(
      document.querySelectorAll('input[type="checkbox"], input[type="radio"]')
    ).filter((el) => isVisible(el) && !isLikelyHoneypot(el));
    groupInputs.forEach((input, i) => {
      const fieldset = input.closest("fieldset");
      if (!fieldset || seenFieldsets.has(fieldset)) return;
      seenFieldsets.add(fieldset);
      const questionText = fieldset.querySelector("legend")?.textContent?.replace("*", "").trim();
      if (!questionText) return;
      const optionInputs = Array.from(
        fieldset.querySelectorAll('input[type="checkbox"], input[type="radio"]')
      ).filter((el) => isVisible(el) && !isLikelyHoneypot(el));
      if (optionInputs.some((o) => o.checked)) return;
      const checkboxOptions = optionInputs.map((optEl) => {
        const optLabel = labelFor(optEl)?.trim();
        return optLabel ? { label: optLabel, input: optEl } : null;
      }).filter((x) => x !== null);
      if (checkboxOptions.length === 0) return;
      results.push({
        field: {
          id: `field-${startIndex + i}`,
          label: questionText,
          fieldType: "checkbox-group",
          options: checkboxOptions.map((o) => o.label)
        },
        element: null,
        checkboxOptions
      });
    });
    return results;
  }
  function setNativeValue(el, value) {
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, value);
    const eventType = el.tagName === "SELECT" ? "change" : "input";
    el.dispatchEvent(new Event(eventType, { bubbles: true }));
  }
  function fillSelect(el, desired) {
    const target = desired.trim().toLowerCase();
    const options = Array.from(el.options);
    const exact = options.find(
      (o) => o.value.toLowerCase() === target || o.textContent?.trim().toLowerCase() === target
    );
    const match = exact ?? options.find((o) => o.textContent?.trim().toLowerCase().includes(target)) ?? options.find((o) => target.includes(o.textContent?.trim().toLowerCase() ?? "\0"));
    if (!match) return false;
    setNativeValue(el, match.value);
    return true;
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function isComboboxInput(el) {
    return el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete") || el.hasAttribute("aria-expanded") || el.hasAttribute("aria-controls") || // A field the candidate can't type real text into is never a plain
    // free-text field — it's a dropdown/picker trigger dressed up as an
    // input, just without ARIA markup declaring it as one (a confirmed
    // real example: a Yes/No dropdown that got a literal string typed
    // into it instead of actually being selected, because it had none of
    // the ARIA attributes above). fillComboboxInput already falls back to
    // plain typing if this guess is wrong and no popup ever opens, so
    // widening the guess here is low-risk.
    el.readOnly;
  }
  function normalizeForMatch(s) {
    return s.trim().toLowerCase().replace(/[-\s]+/g, " ");
  }
  var SCHOOL_SEARCH_STOPWORDS = /* @__PURE__ */ new Set([
    "university",
    "college",
    "institute",
    "school",
    "the",
    "of",
    "at",
    "and",
    "state",
    "technical",
    "community"
  ]);
  function mostDistinctiveWord(value) {
    const candidates = value.split(/[\s,-]+/).filter((w) => w.length > 2 && !SCHOOL_SEARCH_STOPWORDS.has(w.toLowerCase()));
    if (candidates.length === 0) return null;
    return candidates.reduce((a, b) => b.length > a.length ? b : a);
  }
  async function searchComboboxOptions(el, query) {
    el.focus();
    el.click();
    setNativeValue(el, query);
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await sleep(600);
    const listboxId = el.getAttribute("aria-controls");
    const scope = listboxId ? document.getElementById(listboxId) : document;
    return Array.from((scope ?? document).querySelectorAll('[role="option"]')).filter(
      isVisible
    );
  }
  function findBestOption(options, target) {
    const norm = normalizeForMatch(target);
    return options.find((o) => normalizeForMatch(o.textContent ?? "") === norm) ?? options.find((o) => normalizeForMatch(o.textContent ?? "").includes(norm)) ?? options.find((o) => norm.includes(normalizeForMatch(o.textContent ?? " ")));
  }
  async function fillComboboxInput(el, value) {
    let options = await searchComboboxOptions(el, value);
    const popupOpened = el.getAttribute("aria-expanded") === "true" || options.length > 0;
    if (!popupOpened) {
      return true;
    }
    let best = findBestOption(options, value);
    if (!best) {
      const keyword = mostDistinctiveWord(value);
      if (keyword) {
        options = await searchComboboxOptions(el, keyword);
        best = findBestOption(options, value);
      }
    }
    if (!best) {
      setNativeValue(el, "");
      return false;
    }
    best.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    best.click();
    await sleep(150);
    return true;
  }
  function guessCompanyFromHost() {
    const parts = window.location.hostname.split(".");
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  function guessCompanyFromGreenhouseUrl() {
    if (!/(^|\.)greenhouse\.io$/.test(window.location.hostname)) return null;
    const slug = new URLSearchParams(window.location.search).get("for") || window.location.pathname.split("/").filter((s) => s && s !== "embed")[0];
    if (!slug) return null;
    return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  function jobContextFromPage() {
    const title = document.querySelector(".njob-job-header h1")?.textContent?.trim() || document.querySelector("h1")?.textContent?.trim() || document.title;
    const company = document.querySelector(".njob-logo")?.textContent?.trim() || document.querySelector('meta[property="og:site_name"]')?.getAttribute("content")?.trim() || guessCompanyFromGreenhouseUrl() || guessCompanyFromHost();
    const description = document.querySelector(".njob-description")?.textContent?.trim() || document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
    return {
      url: window.location.href,
      title,
      company,
      description
    };
  }
  async function savePendingApplication(jobContext) {
    try {
      await chrome.runtime.sendMessage({ type: "CAREERPILOT_SAVE_PENDING", jobContext });
    } catch (err) {
      console.warn("CareerPilot: could not save pending-application flag \u2014 auto-tracking for this application may not fire.", err);
    }
  }
  async function detectConfirmationWithAI(jobContext) {
    try {
      const res = await bgFetch("/api/autofill/detect-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobContext,
          currentUrl: window.location.href,
          pageText: document.body.innerText.slice(0, 2e3)
        })
      });
      if (!res.ok) return false;
      const { submitted } = res.body;
      return submitted;
    } catch {
      return false;
    }
  }
  function showPendingChecker(jobContext, onCheck) {
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
      btn.textContent = "Checking\u2026";
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
  async function recordApplicationToServer(ctx) {
    try {
      const res = await bgFetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: ctx.company,
          jobTitle: ctx.title,
          jobUrl: ctx.url,
          status: "applied",
          source: "CareerPilot extension"
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  async function checkAndRecordPendingApplication() {
    const { jobContext } = await chrome.runtime.sendMessage({ type: "CAREERPILOT_PEEK_PENDING" });
    if (!jobContext) return;
    const tryDetectAndRecord = async () => {
      const submitted = await detectConfirmationWithAI(jobContext);
      if (!submitted) return false;
      await chrome.runtime.sendMessage({ type: "CAREERPILOT_CLEAR_PENDING" });
      const ok = await recordApplicationToServer(jobContext);
      showToast(
        ok ? `\u2713 Application to ${jobContext.company} recorded in your CareerPilot tracker.` : `Application to ${jobContext.company} submitted, but couldn't be recorded in CareerPilot.`,
        ok ? "success" : "error"
      );
      return true;
    };
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
    let checking = false;
    let lastAttemptAt = 0;
    const MIN_RETRY_GAP_MS = 4e3;
    const observer = new MutationObserver(() => {
      if (checking || resolved || Date.now() - lastAttemptAt < MIN_RETRY_GAP_MS) {
        if (resolved) observer.disconnect();
        return;
      }
      checking = true;
      lastAttemptAt = Date.now();
      void tryDetectAndRecord().then((done) => {
        if (done) {
          resolved = true;
          observer.disconnect();
          checkerHost.remove();
        }
      }).finally(() => {
        checking = false;
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 2e4);
  }
  var ApplyWidget = class {
    host;
    shadow;
    panel;
    // Trigger now lives in the extension popup, not a floating on-page
    // button — this guards against a double-run if the popup somehow
    // sends CAREERPILOT_RUN_FILL twice (e.g. a fast double-click) instead
    // of disabling a page element that no longer exists.
    running = false;
    // Captured while the job posting is still in the DOM — submission swaps
    // the page to a confirmation view that no longer has the job title, so
    // this must be read before that swap happens, not after.
    lastJobContext = null;
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
      this.watchForSubmission();
    }
    setPanel(html) {
      this.panel.innerHTML = html;
      this.panel.classList.add("visible");
    }
    // Called from the popup (via the background relay) instead of an
    // on-page button click.
    runIfIdle() {
      if (this.running) return;
      void this.run();
    }
    async run() {
      this.running = true;
      this.setPanel(`<div class="cp-status">Reading the application form\u2026</div>`);
      const generatedPassword = fillPasswordFields();
      const extracted = extractFields();
      if (extracted.length === 0 && !generatedPassword) {
        this.setPanel(`<div class="cp-status cp-error">No form fields found on this page.</div>`);
        this.running = false;
        return;
      }
      if (extracted.length === 0 && generatedPassword) {
        this.setPanel(this.passwordPanelHtml(generatedPassword));
        this.attachCopyPasswordHandler();
        this.running = false;
        return;
      }
      this.setPanel(`<div class="cp-status">Loading your Career Profile\u2026</div>`);
      let profile;
      try {
        const profileRes = await bgFetch("/api/profile/latest");
        if (!profileRes.ok) {
          throw new Error(
            "No Career Profile found. Upload your resume on the CareerPilot onboarding page first."
          );
        }
        profile = profileRes.body;
      } catch (err) {
        this.setPanel(
          `<div class="cp-status cp-error">${err instanceof Error ? err.message : "Could not load your Career Profile."}</div>`
        );
        this.running = false;
        return;
      }
      this.setPanel(
        `<div class="cp-status">AI is answering ${extracted.length} field${extracted.length === 1 ? "" : "s"} from your profile\u2026</div>`
      );
      this.lastJobContext = jobContextFromPage();
      void savePendingApplication(this.lastJobContext);
      let answers;
      try {
        const res = await bgFetch("/api/autofill/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId: profile.id,
            jobContext: this.lastJobContext,
            fields: extracted.map((e) => e.field)
          })
        });
        if (!res.ok) {
          const body = res.body;
          throw new Error(body?.error ?? "Autofill generation failed.");
        }
        answers = res.body.answers;
      } catch (err) {
        this.setPanel(
          `<div class="cp-status cp-error">${err instanceof Error ? err.message : "Autofill generation failed."}</div>`
        );
        this.running = false;
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
            continue;
          }
          const target = answer.value.trim().toLowerCase();
          const match = entry.checkboxOptions.find((o) => o.label.toLowerCase() === target) ?? entry.checkboxOptions.find((o) => o.label.toLowerCase().includes(target)) ?? entry.checkboxOptions.find((o) => target.includes(o.label.toLowerCase()));
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
          element.title = "CareerPilot: not found in your profile \u2014 please fill this in yourself.";
          continue;
        }
        let ok;
        if (element.tagName === "SELECT") {
          ok = fillSelect(element, answer.value);
        } else if (element instanceof HTMLInputElement && isComboboxInput(element)) {
          this.setPanel(`<div class="cp-status">Searching "${answer.value}"\u2026</div>`);
          ok = await fillComboboxInput(element, answer.value);
        } else {
          setNativeValue(element, answer.value);
          ok = true;
        }
        if (ok) {
          filled++;
          element.style.outline = "2px solid #2f6feb";
          element.style.outlineOffset = "2px";
          element.title = "Filled by CareerPilot AI \u2014 review before submitting.";
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
      this.running = false;
    }
    passwordPanelHtml(password) {
      return `<div class="cp-status cp-done">Generated an account password.</div>${this.passwordNoteHtml(password)}`;
    }
    passwordNoteHtml(password) {
      return `
      <div class="cp-password-note">
        Password: <code>${password}</code>
        <button type="button" class="cp-copy-btn" data-password="${password}">Copy</button>
        <div class="muted">Chrome should offer to save this \u2014 if it doesn't, copy it now.</div>
      </div>
    `;
    }
    attachCopyPasswordHandler() {
      this.panel.querySelector(".cp-copy-btn")?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
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
    watchForSubmission() {
      let checking = false;
      const observer = new MutationObserver(() => {
        if (document.querySelector(".njob-confirmation")) {
          observer.disconnect();
          void this.recordApplication();
          return;
        }
        if (!this.lastJobContext || checking) return;
        checking = true;
        void detectConfirmationWithAI(this.lastJobContext).then((submitted) => {
          if (submitted) {
            observer.disconnect();
            void this.recordApplication();
          }
        }).finally(() => {
          checking = false;
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    async recordApplication() {
      const ctx = this.lastJobContext ?? jobContextFromPage();
      await chrome.runtime.sendMessage({ type: "CAREERPILOT_CLEAR_PENDING" });
      const ok = await recordApplicationToServer(ctx);
      this.setPanel(
        ok ? `<div class="cp-status cp-done">\u2713 Recorded in your CareerPilot tracker.</div>` : `<div class="cp-status cp-error">Application submitted, but couldn't record it in CareerPilot.</div>`
      );
      showToast(
        ok ? `\u2713 Application to ${ctx.company} recorded in your CareerPilot tracker.` : `Application to ${ctx.company} submitted, but couldn't be recorded in CareerPilot.`,
        ok ? "success" : "error"
      );
    }
  };
  var WIDGET_CSS = `
  :host { all: initial; }
  .cp-panel {
    display: none; position: fixed; top: 20px; right: 20px; z-index: 2147483647;
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
  function showToast(message, kind = "success") {
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
    setTimeout(() => host.remove(), 6e3);
  }
  function frameHasFillableForm() {
    if (document.querySelector("select, textarea")) return true;
    const fillableInputs = Array.from(document.querySelectorAll("input")).filter(
      (el) => !SKIPPED_INPUT_TYPES.has(el.type)
    );
    return fillableInputs.length >= 3;
  }
  var activeWidget = null;
  function watchForFillableForm() {
    if (document.querySelector(".app-shell")) return;
    let mounted = false;
    const tryMount = () => {
      if (document.querySelector("#careerpilot-widget-host")) {
        mounted = true;
        return;
      }
      if (!frameHasFillableForm()) return;
      activeWidget = new ApplyWidget();
      mounted = true;
      void chrome.runtime.sendMessage({ type: "CAREERPILOT_FORM_AVAILABLE" }).catch(() => {
      });
    };
    tryMount();
    const observer = new MutationObserver(tryMount);
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      if (!mounted) observer.disconnect();
    }, 2e4);
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "CAREERPILOT_RUN_FILL") {
      activeWidget?.runIfIdle();
    }
  });
  watchForFillableForm();
  if (!document.querySelector(".app-shell")) {
    void checkAndRecordPendingApplication();
  }
})();
