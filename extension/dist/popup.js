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
})();
