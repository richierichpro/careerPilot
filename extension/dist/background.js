"use strict";
(() => {
  // src/background.ts
  var SERVER_URL = "https://careerpilot-production-4b72.up.railway.app";
  var PENDING_KEY = "careerpilot_pending_application";
  var PENDING_MAX_AGE_MS = 30 * 60 * 1e3;
  var formFrameByTab = /* @__PURE__ */ new Map();
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") formFrameByTab.delete(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => formFrameByTab.delete(tabId));
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    if (message?.type === "CAREERPILOT_FORM_AVAILABLE") {
      if (sender.tab?.id !== void 0 && sender.frameId !== void 0) {
        formFrameByTab.set(sender.tab.id, sender.frameId);
      }
      return void 0;
    }
    if (message?.type === "CAREERPILOT_QUERY_FORM_STATE") {
      if (formFrameByTab.has(message.tabId)) {
        sendResponse({ available: true });
        return void 0;
      }
      (async () => {
        try {
          const response = await chrome.tabs.sendMessage(message.tabId, {
            type: "CAREERPILOT_QUERY_LIVE_FORM_STATE"
          });
          if (response?.available) {
            formFrameByTab.set(message.tabId, 0);
            sendResponse({ available: true });
            return;
          }
        } catch {
        }
        sendResponse({ available: false });
      })();
      return true;
    }
    if (message?.type === "CAREERPILOT_TRIGGER_FILL") {
      const frameId = formFrameByTab.get(message.tabId) ?? 0;
      (async () => {
        try {
          await chrome.tabs.sendMessage(message.tabId, { type: "CAREERPILOT_RUN_FILL" }, { frameId });
        } catch {
        }
        sendResponse({ ok: true });
      })();
      return true;
    }
    return void 0;
  });
  chrome.runtime.onInstalled.addListener(() => {
    console.log("CareerPilot extension installed.");
  });
})();
