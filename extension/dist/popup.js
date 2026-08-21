"use strict";
(() => {
  // src/popup.ts
  var WEB_URL = "https://web-production-c0649.up.railway.app";
  document.getElementById("open-profile")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_URL}/onboarding` });
  });
  document.getElementById("open-tracker")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_URL}/applications` });
  });
  async function initApplyButton() {
    const applyRow = document.getElementById("apply-row");
    const noFormHint = document.getElementById("no-form-hint");
    const applyBtn = document.getElementById("apply-with-ai");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const { available } = await chrome.runtime.sendMessage({
      type: "CAREERPILOT_QUERY_FORM_STATE",
      tabId: tab.id
    });
    if (!available) return;
    applyRow?.classList.add("visible");
    noFormHint?.remove();
    applyBtn?.addEventListener("click", () => {
      if (!applyBtn || !tab.id) return;
      applyBtn.disabled = true;
      applyBtn.textContent = "Filling\u2026";
      chrome.runtime.sendMessage({ type: "CAREERPILOT_TRIGGER_FILL", tabId: tab.id }).finally(() => window.close());
    });
  }
  void initApplyButton();
})();
