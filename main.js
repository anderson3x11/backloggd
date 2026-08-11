let allGames = [];
let currentSearch = '';
let currentSort = 'date-desc';

async function init() {
  try {
    const res = await fetch('./data/games.json');
    allGames = await res.json();
  } catch {
    document.getElementById('games-grid').innerHTML =
      '<div class="empty-state">Impossible de charger les jeux.</div>';
    return;
  }
  document.getElementById('nav-count').textContent = allGames.length;
  render();
}

function getFiltered() {
  const q = currentSearch.toLowerCase();
  const list = allGames.filter(g => !q || g.title.toLowerCase().includes(q));
  return sortGames(list, currentSort);
}

function sortGames(list, mode) {
  // L'ordre du fichier est déjà du plus récent au plus ancien, les jeux en
  // cours en tête — on ne le recalcule pas pour le tri par défaut.
  if (mode === 'date-desc') return list;

  const when = g => g.date || g.date_start || '';
  const arr = [...list];

  switch (mode) {
    case 'date-asc':
      return arr.sort((a, b) => when(a).localeCompare(when(b)));
    case 'rating-desc':
      // Les jeux non notés (en cours) partent en fin de liste dans les deux sens.
      return arr.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    case 'rating-asc':
      return arr.sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99));
    case 'title-asc':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    default:
      return arr;
  }
}

function starsHTML(rating) {
  const pct = rating == null ? 0 : Math.max(0, Math.min(100, (rating / 5) * 100));
  const label = rating == null ? 'non noté' : `${rating} sur 5`;
  return `<span class="stars stars--sm" role="img" aria-label="${label}">` +
    `<span class="stars-bg">★★★★★</span>` +
    `<span class="stars-fg" style="width:${pct}%">★★★★★</span>` +
    `</span>`;
}

function cardHTML(game) {
  const cover = game.cover
    ? `<img class="card-cover" src="${game.cover}" alt="${escAttr(game.title)}" loading="lazy">`
    : `<div class="card-cover-placeholder">${escHtml(game.title[0])}</div>`;

  return `
    <a class="game-card" href="./game.html?slug=${encodeURIComponent(game.slug)}">
      <div class="card-cover-wrap">${cover}</div>
      <div class="card-title" title="${escAttr(game.title)}">${escHtml(game.title)}</div>
      ${starsHTML(game.rating)}
    </a>`;
}

function render() {
  const filtered = getFiltered();
  const countEl = document.getElementById('results-count');
  const grid = document.getElementById('games-grid');

  countEl.textContent = currentSearch
    ? `${filtered.length} résultat${filtered.length !== 1 ? 's' : ''}`
    : '';

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">Aucun jeu trouvé.</div>';
    return;
  }

  grid.innerHTML = filtered.map(cardHTML).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;');
}

const searchEl = document.getElementById('search');

searchEl.addEventListener('input', e => {
  currentSearch = e.target.value;
  render();
});

document.getElementById('sort').addEventListener('change', e => {
  currentSort = e.target.value;
  render();
});

const isTyping = () =>
  /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

document.addEventListener('keydown', e => {
  if (e.key === '/' && !isTyping()) {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
  } else if (e.key === 'Escape' && document.activeElement === searchEl) {
    searchEl.value = '';
    currentSearch = '';
    render();
    searchEl.blur();
  }
});

init();
