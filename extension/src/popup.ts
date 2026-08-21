const WEB_URL = "https://web-production-c0649.up.railway.app";

document.getElementById("open-profile")?.addEventListener("click", () => {
  chrome.tabs.create({ url: `${WEB_URL}/onboarding` });
});

document.getElementById("open-tracker")?.addEventListener("click", () => {
  chrome.tabs.create({ url: `${WEB_URL}/applications` });
});

// The fill trigger lives here instead of a floating on-page button — it
// only shows up when the active tab's content script has actually
// reported a fillable form (via the background script, since a popup has
// no direct access to the page's DOM). Progress and results still show on
// the page itself (the panel that used to sit next to the old button),
// since the popup closes the moment the user clicks back onto the page.
async function initApplyButton(): Promise<void> {
  const applyRow = document.getElementById("apply-row");
  const noFormHint = document.getElementById("no-form-hint");
  const applyBtn = document.getElementById("apply-with-ai") as HTMLButtonElement | null;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const { available } = (await chrome.runtime.sendMessage({
    type: "CAREERPILOT_QUERY_FORM_STATE",
    tabId: tab.id,
  })) as { available: boolean };

  if (!available) return;

  applyRow?.classList.add("visible");
  noFormHint?.remove();

  applyBtn?.addEventListener("click", () => {
    if (!applyBtn || !tab.id) return;
    applyBtn.disabled = true;
    applyBtn.textContent = "Filling…";
    void chrome.runtime.sendMessage({ type: "CAREERPILOT_TRIGGER_FILL", tabId: tab.id });
    // The actual fill runs on the page (bgFetch/AI calls need that
    // context) and can take 10-20+ seconds — closing the popup here
    // (rather than leaving it stuck on "Filling…") lets the user see the
    // page's own progress panel immediately instead of a frozen popup.
    window.close();
  });
}

void initApplyButton();
