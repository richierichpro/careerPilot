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
    // Closing the popup right after firing sendMessage (without waiting
    // for it to actually land) was a real, intermittent bug — the popup's
    // JS context could tear down before the message finished being
    // dispatched to the background, so the fill sometimes silently never
    // started at all. Awaiting the round-trip first (even though the
    // response has no real payload) guarantees the message was actually
    // delivered before the popup that sent it goes away.
    chrome.runtime
      .sendMessage({ type: "CAREERPILOT_TRIGGER_FILL", tabId: tab.id })
      .finally(() => window.close());
  });
}

void initApplyButton();
