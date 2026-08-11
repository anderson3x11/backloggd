/* Condense the floating header into a pill once the page leaves the top. */
(function () {
  const header = document.querySelector('header');
  if (!header) return;

  let ticking = false;

  function update() {
    header.classList.toggle('is-pinned', window.scrollY > 8);
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });

  update();
})();
