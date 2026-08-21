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

const SERVER_URL = "http://localhost:8787";

chrome.runtime.onMessage.addListener((message: BackendFetchRequest, _sender, sendResponse) => {
  if (message?.type !== "CAREERPILOT_FETCH") return undefined;

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
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("CareerPilot extension installed.");
});
