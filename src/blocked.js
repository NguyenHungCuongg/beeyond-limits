/* global chrome */

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const domain = params.get("domain") || "This site";
  document.getElementById("blocked-domain").textContent = domain;

  document.getElementById("back-button").addEventListener("click", () => {
    if (history.length > 1) {
      history.back();
      return;
    }
    chrome.tabs.getCurrent((tab) => tab && chrome.tabs.remove(tab.id));
  });

  showFocusSession();
});

async function showFocusSession() {
  const { activeFocusSession: session } =
    (await chrome.storage?.local.get("activeFocusSession")) ?? {};
  if (session?.phase !== "focus") return;

  const isPaused = session.status === "paused_focus";
  if (session.status !== "active_focus" && !isPaused) return;

  const seconds = isPaused
    ? session.remainingSeconds
    : (session.phaseEndsAt - Date.now()) / 1000;
  const minutes = Math.max(1, Math.ceil(seconds / 60));

  document.getElementById("session-goal").textContent =
    session.goal?.text || "Focused work";
  document.getElementById("session-time").textContent = isPaused
    ? `Paused · ${minutes} min left`
    : `${minutes} min left`;
  document.getElementById("session").hidden = false;
}
