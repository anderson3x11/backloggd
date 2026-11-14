// Depuis une fiche, « ← Journal » et le logo mènent tous deux à index.html :
// l'URL seule ne les distingue pas. Le logo veut dire « en haut », donc il
// efface la position mémorisée. (Même clé que SCROLL_KEY dans main.js.)
(function () {
  const title = document.querySelector('.site-title');
  if (!title) return;
  title.addEventListener('click', () => {
    try { sessionStorage.removeItem('backloggd:listScroll'); } catch { /* ignore */ }
  });
})();
