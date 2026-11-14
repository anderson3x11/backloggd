/* Condense the floating header into a pill once the page leaves the top. */
(function () {
  // Depuis une fiche, « ← Retour » et le logo mènent tous deux à index.html :
  // l'URL seule ne les distingue pas. Le logo veut dire « en haut », donc il
  // efface la position mémorisée. (Même clé que SCROLL_KEY dans main.js.)
  const title = document.querySelector('.site-title');
  if (title) {
    title.addEventListener('click', () => {
      try { sessionStorage.removeItem('backloggd:listScroll'); } catch { /* ignore */ }
    });
  }

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
