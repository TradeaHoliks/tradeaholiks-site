// Tools page: renders the free-tool cards from tools.json and gates the
// downloads behind a logged-in account.
//
// How it works:
//  - Tool files live in a PRIVATE Supabase Storage bucket named "tools".
//  - Logged-OUT visitors see "Create account to download" -> account.html.
//  - Logged-IN visitors get a real "Download" button. On click we ask
//    Supabase for a short-lived (2-minute) signed link to that file and
//    start the download. The bucket stays private the whole time.
//  - A tool with an empty "file" in tools.json shows as "Coming soon".
(function () {
  var SB_URL = "https://wgbavpqlesskdhzgfmgr.supabase.co";
  var SB_KEY = "sb_publishable_mxXA9uEjTXcNEt06eRqnOQ_3fAHgdZd";
  var BUCKET = "tools";          // private Storage bucket holding the files
  var LINK_TTL = 120;            // signed-link lifetime, in seconds

  var indGrid = document.getElementById("ind-grid");
  var addonGrid = document.getElementById("addon-grid");
  if (!indGrid && !addonGrid) return;

  var sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SB_URL, SB_KEY)
    : null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Build one card. `loggedIn` decides which button we show.
  function card(tool, loggedIn) {
    var hasFile = tool.file && String(tool.file).trim() !== "";
    var meta = esc(tool.platform || "NinjaTrader 8") + " &middot; v" +
               esc(tool.version || "1.0") + (hasFile ? "" : " &middot; coming soon");

    var btn, note;
    if (!hasFile) {
      btn = '<button class="btn btn-block" disabled style="opacity:.55;cursor:not-allowed">Coming soon</button>';
      note = '<div class="lock-note"><b>Free</b> &mdash; coming soon</div>';
    } else if (!loggedIn) {
      btn = '<a href="account.html" class="btn btn-block">Create account to download</a>';
      note = '<div class="lock-note"><b>Free</b> &mdash; account required</div>';
    } else {
      btn = '<button class="btn btn-block tah-download" data-file="' + esc(tool.file) +
            '" data-name="' + esc(tool.name) + '">Download</button>';
      note = '<div class="lock-note tah-dl-msg"><b>Free</b> &mdash; ready to download</div>';
    }

    return '' +
      '<div class="tool-card">' +
        '<div class="tool-top"><div class="tool-ico">' + esc(tool.icon || "📦") +
          '</div><span class="badge-free">FREE</span></div>' +
        '<h3>' + esc(tool.name) + '</h3>' +
        '<p>' + esc(tool.blurb) + '</p>' +
        '<div class="tool-meta">' + meta + '</div>' +
        btn + note +
      '</div>';
  }

  function renderInto(grid, list, loggedIn) {
    if (!grid) return;
    if (!list || !list.length) { grid.innerHTML = ""; return; }
    grid.innerHTML = list.map(function (t) { return card(t, loggedIn); }).join("");
  }

  // Click handler for the live Download buttons (event delegation).
  function wireDownloads() {
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".tah-download");
      if (!b) return;
      e.preventDefault();
      if (!sb) return;
      var path = b.getAttribute("data-file");
      var msgEl = b.parentNode.querySelector(".tah-dl-msg");
      var orig = b.textContent;
      b.disabled = true; b.textContent = "Preparing…";
      sb.storage.from(BUCKET).createSignedUrl(path, LINK_TTL, { download: true })
        .then(function (res) {
          b.disabled = false; b.textContent = orig;
          if (res.error || !res.data || !res.data.signedUrl) {
            if (msgEl) { msgEl.innerHTML = "Couldn’t start the download — please try again."; }
            return;
          }
          window.location.href = res.data.signedUrl;
        })
        .catch(function () {
          b.disabled = false; b.textContent = orig;
          if (msgEl) { msgEl.innerHTML = "Couldn’t start the download — please try again."; }
        });
    });
  }

  function loadingState() {
    var html = '<div style="color:var(--muted);grid-column:1 / -1">Loading tools…</div>';
    if (indGrid) indGrid.innerHTML = html;
    if (addonGrid) addonGrid.innerHTML = html;
  }

  function errorState() {
    var html = '<div style="color:var(--muted);grid-column:1 / -1">Couldn’t load the tools list right now — please refresh.</div>';
    if (indGrid) indGrid.innerHTML = html;
    if (addonGrid) addonGrid.innerHTML = html;
  }

  function start() {
    loadingState();
    var manifestP = fetch("tools.json", { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("manifest " + r.status);
      return r.json();
    });
    var sessionP = sb
      ? sb.auth.getSession().then(function (res) {
          return !!(res && res.data && res.data.session && res.data.session.user);
        }).catch(function () { return false; })
      : Promise.resolve(false);

    Promise.all([manifestP, sessionP]).then(function (out) {
      var data = out[0] || {};
      var loggedIn = out[1];
      renderInto(indGrid, data.indicators || [], loggedIn);
      renderInto(addonGrid, data.addons || [], loggedIn);
    }).catch(function () { errorState(); });
  }

  wireDownloads();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
