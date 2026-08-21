"use strict";
(() => {
  // src/popup.ts
  var SERVER_URL = "https://careerpilot-production-4b72.up.railway.app";
  var WEB_URL = "http://localhost:5174";
  function setRow(prefix, status, title, detail) {
    const dot = document.getElementById(`${prefix}-dot`);
    const titleEl = document.getElementById(`${prefix}-title`);
    const detailEl = document.getElementById(`${prefix}-detail`);
    if (dot) dot.className = `dot ${status === "neutral" ? "" : status}`;
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
  }
  async function checkBackend() {
    try {
      const res = await fetch(`${SERVER_URL}/api/health`);
      if (!res.ok) throw new Error();
      setRow("backend", "ok", "Backend connected", SERVER_URL);
      return true;
    } catch {
      setRow("backend", "bad", "Backend not reachable", "Is the server running?");
      return false;
    }
  }
  async function checkProfile() {
    try {
      const res = await fetch(`${SERVER_URL}/api/profile/latest`);
      if (!res.ok) throw new Error();
      const profile = await res.json();
      setRow(
        "profile",
        "ok",
        profile.name ? `Career Profile: ${profile.name}` : "Career Profile loaded",
        `${profile.experience.length} roles \xB7 ${profile.skills.length} skills`
      );
    } catch {
      setRow("profile", "bad", "No Career Profile yet", "Upload your resume to get started");
    }
  }
  async function checkPage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    if (/^https?:\/\//.test(url)) {
      setRow("page", "ok", "Ready to apply here", "Look for the Apply with AI button on the page");
    } else {
      setRow("page", "neutral", "Not a supported page", "Open a job application page to use Apply with AI");
    }
  }
  document.getElementById("open-profile")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_URL}/onboarding` });
  });
  document.getElementById("open-tracker")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_URL}/applications` });
  });
  void checkBackend();
  void checkProfile();
  void checkPage();
})();
