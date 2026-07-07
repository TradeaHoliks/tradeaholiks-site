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
//  - A tool with an "image" in tools.json shows a screenshot thumbnail at
//    the top of its card; clicking it opens the image full-size (lightbox).
(function () {
  var SB_URL = "https://wgbavpqlesskdhzgfmgr.supabase.co";
  var SB_KEY = "sb_publishable_mxXA9uEjTXcNEt06eRqnOQ_3fAHgdZd";
  var BUCKET = "tools";           // private Storage bucket holding the files
  var LINK_TTL = 120;             // signed-link lifetime, in seconds

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

  // Inject the small bit of CSS the thumbnail + lightbox need (once).
  function injectStyles() {
    if (document.getElementById("tah-tools-css")) return;
    var css = ''
      + '.tool-shot{display:block;width:100%;max-height:300px;object-fit:contain;'
      + 'background:#0d0f13;border:1px solid var(--line,#2a2e37);border-radius:10px;'
      + 'margin-bottom:14px;cursor:zoom-in;transition:opacity .15s}'
      + '.tool-shot:hover{opacity:.9}'
      + '.tah-lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;'
      + 'align-items:center;justify-content:center;z-index:9999;padding:24px;cursor:zoom-out}'
      + '.tah-lb img{max-width:95%;max-height:95%;border-radius:10px;'
      + 'box-shadow:0 12px 48px rgba(0,0,0,.6);cursor:default}'
      + '.tah-lb-x{position:absolute;top:14px;right:22px;color:#fff;font-size:34px;'
      + 'line-height:1;cursor:pointer;font-family:system-ui,sans-serif}';
    var st = document.createElement("style");
    st.id = "tah-tools-css";
    st.textContent = css;
    document.head.appendChild(st);
  }

  // Build one card. `loggedIn` decides which button we show.
  function card(tool, loggedIn) {
    var hasFile = tool.file && String(tool.file).trim() !== "";
    var meta = esc(tool.platform || "NinjaTrader 8") + " &middot; v" +
               esc(tool.version || "1.0") + (hasFile ? "" : " &middot; coming soon");

    var shot = (tool.image && String(tool.image).trim() !== "")
      ? '<img class="tool-shot" src="' + esc(tool.image) + '" alt="' + esc(tool.name) +
        ' screenshot" loading="lazy">'
      : '';

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
        shot +
        '<div class="tool-top"><div class="tool-ico">' + esc(tool.icon || "📦") +
          '</div><span class="badge-free">FREE</span></div>' +
        '<h3>' + esc(tool.name) + '</h3>' +
        '<p>' + esc(tool.blurb) + '</p>' +
        '<div class="tool-meta">' + meta + '</div>' +
        btn + note +
      '</div>';
  }

  // Renders a section's cards. If the list is empty, the whole section
  // (heading + grid) is hidden until a tool is added to tools.json.
  function renderInto(grid, headId, list, loggedIn) {
    if (!grid) return;
    var head = headId ? document.getElementById(headId) : null;
    if (!list || !list.length) {
      grid.innerHTML = "";
      grid.style.display = "none";
      if (head) head.style.display = "none";
      return;
    }
    grid.style.display = "";
    if (head) head.style.display = "";
    grid.innerHTML = list.map(function (t) { return card(t, loggedIn); }).join("");
  }

  // Full-size image overlay.
  function openLightbox(src, alt) {
    var lb = document.createElement("div");
    lb.className = "tah-lb";
    lb.innerHTML = '<span class="tah-lb-x" aria-label="Close">&times;</span>' +
                   '<img src="' + src + '" alt="' + (alt || "") + '">';
    function close() {
      lb.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    lb.addEventListener("click", function (e) {
      // click on backdrop or the X closes; click on the image itself does not
      if (e.target === lb || e.target.classList.contains("tah-lb-x")) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(lb);
  }

  // Clicks: Download buttons + screenshot thumbnails (event delegation).
  function wireClicks() {
    document.addEventListener("click", function (e) {
      var shot = e.target.closest && e.target.closest(".tool-shot");
      if (shot) { openLightbox(shot.getAttribute("src"), shot.getAttribute("alt")); return; }

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
    injectStyles();
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
      renderInto(indGrid, "ind-head", data.indicators || [], loggedIn);
      renderInto(addonGrid, "addon-head", data.addons || [], loggedIn);
    }).catch(function () { errorState(); });
  }

  wireClicks();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else { start(); }
})();
