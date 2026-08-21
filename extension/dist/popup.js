"use strict";
(() => {
  // src/popup.ts
  var WEB_URL = "http://localhost:5174";
  document.getElementById("open-profile")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_URL}/onboarding` });
  });
  document.getElementById("open-tracker")?.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_URL}/applications` });
  });
})();
