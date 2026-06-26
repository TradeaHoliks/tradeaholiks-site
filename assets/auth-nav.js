// Site-wide nav auth state: if the visitor is logged in, the nav shows
// "My account" + "Log out" instead of "Log in" + "Create account".
// Reads the Supabase session from local storage (light, no network on
// normal page views). Only loads supabase-js when actually logging out.
(function () {
  var REF = "wgbavpqlesskdhzgfmgr";
  var SB_URL = "https://wgbavpqlesskdhzgfmgr.supabase.co";
  var SB_KEY = "sb_publishable_mxXA9uEjTXcNEt06eRqnOQ_3fAHgdZd";
  var STORAGE_KEY = "sb-" + REF + "-auth-token";

  function getSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      var sess = (s && s.currentSession) ? s.currentSession : s;
      if (sess && sess.user) {
        var exp = sess.expires_at ? sess.expires_at * 1000 : 0;
        if (!exp || exp > Date.now()) return sess;
      }
    } catch (e) {}
    return null;
  }

  function logout(e) {
    if (e) e.preventDefault();
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    var sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    sc.onload = function () {
      try {
        var c = window.supabase.createClient(SB_URL, SB_KEY);
        c.auth.signOut().finally(function () { window.location.href = "index.html"; });
      } catch (_) { window.location.href = "index.html"; }
    };
    sc.onerror = function () { window.location.href = "index.html"; };
    document.head.appendChild(sc);
  }

  function apply() {
    if (!getSession()) return; // logged out -> leave default nav
    var login = document.querySelector(".nav-login");
    if (login) { login.textContent = "My account"; login.setAttribute("href", "account.html"); }
    var cta = document.querySelector(".nav-cta .btn");
    if (cta) {
      cta.textContent = "Log out";
      cta.setAttribute("href", "#");
      cta.addEventListener("click", logout);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else { apply(); }
})();
