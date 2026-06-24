// Tradeaholiks — small site interactions
// 1) Mobile nav toggle  2) Placeholder form handling (no backend yet)
(function () {
  // Mobile menu
  var btn = document.querySelector('.menu-btn');
  var links = document.querySelector('.nav-links');
  if (btn && links) {
    btn.addEventListener('click', function () { links.classList.toggle('open'); });
  }

  // Placeholder forms (e.g. the account create/login forms): until the backend is
  // wired up in Phase 2, show a friendly message instead of sending anything.
  document.querySelectorAll('form[data-placeholder]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = form.querySelector('.form-msg');
      if (msg) {
        msg.textContent = "Thanks! Accounts aren't live yet — this will be switched on before launch.";
        msg.style.display = 'block';
      }
      form.reset();
    });
  });

  // Contact form: posts to Web3Forms (no backend needed) and shows an inline result.
  var cform = document.getElementById('contact-form');
  if (cform) {
    cform.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = cform.querySelector('.form-msg');
      var send = cform.querySelector('button[type=submit]');
      if (send) { send.disabled = true; send.textContent = 'Sending…'; }
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(cform)
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (msg) {
          msg.textContent = data.success
            ? "Thanks — your message is on its way. We'll get back to you soon."
            : 'Sorry, something went wrong. Please email us directly at tradeaholiks@gmail.com.';
          msg.style.color = data.success ? 'var(--accent)' : '#ff5d5d';
          msg.style.display = 'block';
        }
        if (data.success) cform.reset();
        if (send) { send.disabled = false; send.textContent = 'Send message'; }
      }).catch(function () {
        if (msg) {
          msg.textContent = 'Network error — please email us directly at tradeaholiks@gmail.com.';
          msg.style.color = '#ff5d5d';
          msg.style.display = 'block';
        }
        if (send) { send.disabled = false; send.textContent = 'Send message'; }
      });
    });
  }
})();
