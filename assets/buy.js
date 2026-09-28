// Buy buttons -> Gumroad checkout.
//
// Mark any link or button with data-buy="journal" or data-buy="alertfill".
// Give it a real href (account.html) as the no-JS fallback; this script takes
// over the click when JS is available.
//
//   <a href="account.html" class="btn" data-buy="journal">Buy Easy Journal &mdash; $149</a>
//
// Logged out -> sent to account.html to log in or sign up first. That is
// deliberate: the licence is issued against the account email, so we need them
// signed in BEFORE they pay, not after.
//
// Logged in -> straight to Gumroad's checkout (?wanted=true) carrying
// &tah=<account id>. Gumroad hands that back to us in url_params on the sale
// ping, and the gumroad-webhook function uses it to put the licence on the
// right account even if they pay with a different email address.
//
// Clicks are caught on the document, not bound per button, so buttons the
// account page draws later (the licence box, the trial-ended line) work too.
(function () {
  var REF = "wgbavpqlesskdhzgfmgr";
  var STORAGE_KEY = "sb-" + REF + "-auth-token";

  // Gumroad product links. Handle + custom permalink, from the Gumroad
  // products dashboard. If a permalink ever changes, change it here AND in
  // the gumroad-webhook function's id list, or sales stop matching.
  var LINKS = {
    journal:   "https://tradeaholiks.gumroad.com/l/easy-journal",
    alertfill: "https://tradeaholiks.gumroad.com/l/alertfill"
  };

  // Same session read as auth-nav.js: no network on a normal page view.
  function getSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      var sess = (s && s.currentSession) ? s.currentSession : s;
      if (sess && sess.access_token) {
        var exp = sess.expires_at ? sess.expires_at * 1000 : 0;
        if (!exp || exp > Date.now()) return sess;
      }
    } catch (e) {}
    return null;
  }

  function checkoutUrl(product, uid) {
    var url = LINKS[product];
    if (!url) return "";
    url += "?wanted=true";
    if (uid) url += "&tah=" + encodeURIComponent(uid);
    return url;
  }

  function start(el, product) {
    if (!LINKS[product]) return;

    var sess = getSession();
    if (!sess) {
      // Not logged in - send them to sign up, and remember what they wanted.
      try { sessionStorage.setItem("tah_buy_intent", product); } catch (_) {}
      window.location.href = "account.html";
      return;
    }

    var uid = (sess.user && sess.user.id) ? sess.user.id : "";
    if (el && el.textContent) {
      el.textContent = "Opening checkout…";
      el.style.pointerEvents = "none";
    }
    window.location.href = checkoutUrl(product, uid);
  }

  document.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el !== document && !(el.getAttribute && el.getAttribute("data-buy"))) {
      el = el.parentNode;
    }
    if (!el || el === document) return;
    var product = el.getAttribute("data-buy");
    if (!product || !LINKS[product]) return;
    e.preventDefault();
    start(el, product);
  });
})();
