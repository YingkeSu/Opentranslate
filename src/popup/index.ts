document.getElementById("open-options")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});
