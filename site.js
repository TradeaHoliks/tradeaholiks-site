// Tradeaholiks — small site interactions
// 1) Mobile nav toggle  2) Placeholder form handling (no backend yet)
(function () {
  // Mobile menu
  var btn = document.querySelector('.menu-btn');
  var links = document.querySelector('.nav-links');
  if (btn && links) {
    btn.addEventListener('click', function () { links.classList.toggle('open'); });
  }

  // Placeholder forms: until a backend/email service is wired up, show a friendly
  // message instead of actually sending anything anywhere.
  document.querySelectorAll('form[data-placeholder]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = form.querySelector('.form-msg');
      if (msg) {
        msg.textContent = "Thanks! Sign-ups aren't live yet — this form will be connected before launch.";
        msg.style.display = 'block';
      }
      form.reset();
    });
  });
})();
