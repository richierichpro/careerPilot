// Content scripts run inside the page's own security context, so a fetch()
// from a content script on an https:// page to our http://localhost backend
// is blocked as mixed content — it just hangs, never even rejecting. The
// background service worker is a privileged extension context exempt from
// that restriction, so content scripts proxy their API calls through here.

interface BackendFetchRequest {
  type: "CAREERPILOT_FETCH";
  path: string;
  init?: RequestInit;
}

interface BackendFetchResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

interface SavePendingRequest {
  type: "CAREERPILOT_SAVE_PENDING";
  jobContext: unknown;
}

interface PeekPendingRequest {
  type: "CAREERPILOT_PEEK_PENDING";
}

interface ClearPendingRequest {
  type: "CAREERPILOT_CLEAR_PENDING";
}

interface FormAvailableRequest {
  type: "CAREERPILOT_FORM_AVAILABLE";
}

interface QueryFormStateRequest {
  type: "CAREERPILOT_QUERY_FORM_STATE";
  tabId: number;
}

interface TriggerFillRequest {
  type: "CAREERPILOT_TRIGGER_FILL";
  tabId: number;
}

type ExtensionMessage =
  | BackendFetchRequest
  | SavePendingRequest
  | PeekPendingRequest
  | ClearPendingRequest
  | FormAvailableRequest
  | QueryFormStateRequest
  | TriggerFillRequest;

const SERVER_URL = "https://careerpilot-production-4b72.up.railway.app";
const PENDING_KEY = "careerpilot_pending_application";
const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

// The Apply with AI trigger lives in the popup now, not on the page, so
// the popup needs to know which frame (if any) of the active tab actually
// found a fillable form — content scripts report in here as soon as they
// find one (all_frames means many irrelevant frames inject too: ads,
// trackers, recaptcha — only ones that actually detect a real form ever
// send this). Cleared on navigation so a stale form from the PREVIOUS page
// at this tab id doesn't linger.
const formFrameByTab = new Map<number, number>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") formFrameByTab.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => formFrameByTab.delete(tabId));

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message?.type === "CAREERPILOT_FETCH") {
    (async () => {
      try {
        const res = await fetch(`${SERVER_URL}${message.path}`, message.init);
        const body = await res.json().catch(() => null);
        const response: BackendFetchResponse = { ok: res.ok, status: res.status, body };
        sendResponse(response);
      } catch (err) {
        const response: BackendFetchResponse = {
          ok: false,
          status: 0,
          body: { error: err instanceof Error ? err.message : "Network request failed." },
        };
        sendResponse(response);
      }
    })();
    return true; // keep the message channel open for the async sendResponse
  }

  // chrome.storage.session isn't accessible from content scripts by
  // default (only trusted contexts like this background script), so the
  // content script proxies through here — same reason as the fetch proxy
  // above. This is what lets "Apply with AI" get remembered across a real
  // page navigation to a confirmation URL, which destroys the content
  // script's own JS context and any in-memory state with it.
  if (message?.type === "CAREERPILOT_SAVE_PENDING") {
    void chrome.storage.session
      .set({ [PENDING_KEY]: { jobContext: message.jobContext, timestamp: Date.now() } })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  // Peek, don't take — a real submit flow can involve an intermediate
  // page (a loading state, a redirect hop) before the actual confirmation
  // page loads, and each of those pages' content scripts calls this. If
  // the first one to ask consumed the flag, a genuine confirmation two
  // hops later would find nothing left to record. The content script
  // explicitly clears it once it actually acts on a match instead.
  if (message?.type === "CAREERPILOT_PEEK_PENDING") {
    (async () => {
      const stored = await chrome.storage.session.get(PENDING_KEY);
      const pending = stored[PENDING_KEY] as { jobContext: unknown; timestamp: number } | undefined;
      if (!pending || Date.now() - pending.timestamp > PENDING_MAX_AGE_MS) {
        if (pending) await chrome.storage.session.remove(PENDING_KEY); // expired — clean up
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
    if (sender.tab?.id !== undefined && sender.frameId !== undefined) {
      formFrameByTab.set(sender.tab.id, sender.frameId);
    }
    return undefined; // fire-and-forget, no response needed
  }

  if (message?.type === "CAREERPILOT_QUERY_FORM_STATE") {
    sendResponse({ available: formFrameByTab.has(message.tabId) });
    return undefined;
  }

  if (message?.type === "CAREERPILOT_TRIGGER_FILL") {
    const frameId = formFrameByTab.get(message.tabId);
    if (frameId !== undefined) {
      void chrome.tabs.sendMessage(message.tabId, { type: "CAREERPILOT_RUN_FILL" }, { frameId });
    }
    return undefined;
  }

  return undefined;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("CareerPilot extension installed.");
});
