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
// no direct access to the page's DOM).
async function initApplyButton(): Promise<void> {
  const applyRow = document.getElementById("apply-row");
  const noFormHint = document.getElementById("no-form-hint");
  const applyBtn = document.getElementById("apply-with-ai") as HTMLButtonElement | null;
  const statusEl = document.getElementById("apply-status");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const { available } = (await chrome.runtime.sendMessage({
    type: "CAREERPILOT_QUERY_FORM_STATE",
    tabId: tab.id,
  })) as { available: boolean };

  if (!available) return;

  applyRow?.classList.add("visible");
  noFormHint?.remove();

  // chrome.runtime.sendMessage broadcasts within the extension, so the
  // content script's status updates reach this listener directly as long
  // as the popup stays open — no relay through the background needed.
  // The on-page floating panel wasn't reliably visible in practice, so
  // this is the primary place progress shows up now.
  chrome.runtime.onMessage.addListener((message: { type?: string; text?: string }) => {
    if (message?.type === "CAREERPILOT_FILL_PROGRESS" && statusEl) {
      statusEl.textContent = message.text ?? "";
      statusEl.classList.add("visible");
    }
  });

  applyBtn?.addEventListener("click", () => {
    if (!applyBtn || !tab.id) return;
    applyBtn.disabled = true;
    applyBtn.textContent = "Filling…";
    // Keep the popup open (no window.close() here) so the status
    // messages above have somewhere to render — the user just needs to
    // leave the popup open rather than clicking back onto the page while
    // it runs. It stays open on its own as long as nothing else is
    // clicked, same as any Chrome extension popup.
    void chrome.runtime.sendMessage({ type: "CAREERPILOT_TRIGGER_FILL", tabId: tab.id });
  });
}

void initApplyButton();
