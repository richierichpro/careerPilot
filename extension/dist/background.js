"use strict";
(() => {
  // src/background.ts
  var SERVER_URL = "https://careerpilot-production-4b72.up.railway.app";
  var PENDING_KEY = "careerpilot_pending_application";
  var PENDING_MAX_AGE_MS = 30 * 60 * 1e3;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CAREERPILOT_FETCH") {
      (async () => {
        try {
          const res = await fetch(`${SERVER_URL}${message.path}`, message.init);
          const body = await res.json().catch(() => null);
          const response = { ok: res.ok, status: res.status, body };
          sendResponse(response);
        } catch (err) {
          const response = {
            ok: false,
            status: 0,
            body: { error: err instanceof Error ? err.message : "Network request failed." }
          };
          sendResponse(response);
        }
      })();
      return true;
    }
    if (message?.type === "CAREERPILOT_SAVE_PENDING") {
      void chrome.storage.session.set({ [PENDING_KEY]: { jobContext: message.jobContext, timestamp: Date.now() } }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message?.type === "CAREERPILOT_PEEK_PENDING") {
      (async () => {
        const stored = await chrome.storage.session.get(PENDING_KEY);
        const pending = stored[PENDING_KEY];
        if (!pending || Date.now() - pending.timestamp > PENDING_MAX_AGE_MS) {
          if (pending) await chrome.storage.session.remove(PENDING_KEY);
          sendResponse({ jobContext: null });
        } else {
          sendResponse({ jobContext: pending.jobContext });
        }
      })();
      return true;
    }
    if (message?.type === "CAREERPILOT_CLEAR_PENDING") {
      void chrome.storage.session.remove(PENDING_KEY).then(() => sendResponse({ ok: true }));
      return true;
    }
    return void 0;
  });
  chrome.runtime.onInstalled.addListener(() => {
    console.log("CareerPilot extension installed.");
  });
})();
