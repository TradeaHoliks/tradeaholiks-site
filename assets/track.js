// Counts download clicks, account-page tab clicks and tool screenshot views in Umami
// (our own visitor counter at stats.tradeaholiks.com). No cookies, no personal data:
// only the file / tab / tool name is sent. If Umami is blocked or not loaded, this does nothing.
(function () {
  function send(name, data) {
    try { if (window.umami && window.umami.track) window.umami.track(name, data); } catch (e) {}
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var tab = t.closest(".atab");
    if (tab) {
      send("tab", { tab: (tab.getAttribute("data-pane") || "").replace("pane-", "") || tab.textContent.trim() });
      return;
    }
    var shot = t.closest("img.tool-shot");
    if (shot) {
      send("look", { tool: (shot.getAttribute("alt") || "").replace(/ screenshot$/, "") });
      return;
    }
    var dl = t.closest("[data-file], a[href*='downloads.tradeaholiks.com']");
    if (dl) {
      var file = dl.getAttribute("data-file") || (dl.getAttribute("href") || "").split("/").pop();
      if (file) send("download", { file: file, page: location.pathname.replace(/^\//, "").replace(/\.html$/, "") || "home" });
    }
  }, true);
})();
