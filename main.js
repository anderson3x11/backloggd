let allGames = [];

// L'état de la liste vit dans l'URL : en revenant depuis la fiche d'un jeu,
// le navigateur restaure l'adresse et donc la recherche et le tri.
const params = new URLSearchParams(window.location.search);
let currentSearch = params.get('q') || '';
let currentSort = params.get('sort') || 'date-desc';
let currentReview = params.get('critique') || 'tous';

// La grille étant construite en JS, le navigateur restaure le défilement avant
// qu'elle existe et retombe donc à zéro. On le fait nous-mêmes, après le rendu.
const SCROLL_KEY = 'backloggd:listScroll';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function rememberScroll() {
  try {
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
      url: window.location.search,
      y: Math.round(window.scrollY),
    }));
  } catch { /* stockage indisponible : on s'en passe */ }
}

function restoreScroll() {
  try {
    const raw = sessionStorage.getItem(SCROLL_KEY);
    // Usage unique : consommée dès la lecture, pour qu'un rechargement ou un
    // clic sur le logo repartent bien du haut.
    sessionStorage.removeItem(SCROLL_KEY);
    const saved = JSON.parse(raw || 'null');
    if (saved && saved.url === window.location.search && saved.y > 0) {
      // instant : sinon le scroll-behavior: smooth du CSS anime la descente.
      window.scrollTo({ top: saved.y, behavior: 'instant' });
    }
  } catch { /* idem */ }
}

function syncURL() {
  const q = new URLSearchParams();
  if (currentSearch) q.set('q', currentSearch);
  if (currentSort !== 'date-desc') q.set('sort', currentSort);
  if (currentReview !== 'tous') q.set('critique', currentReview);
  const query = q.toString();
  // replaceState et non pushState : sinon chaque frappe empilerait une entrée
  // d'historique et le bouton Retour deviendrait inutilisable.
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

async function init() {
  try {
    const res = await fetch('./data/games.json');
    allGames = await res.json();
  } catch {
    document.getElementById('games-grid').innerHTML =
      '<div class="empty-state mono">Impossible de charger les jeux.</div>';
    return;
  }
  renderHero();
  renderStats();
  renderFavorites();
  render();
  restoreScroll();
}

// Le hero met en avant la dernière partie, et fait défiler les titres récents
// comme le bandeau du portfolio fait défiler le nom.
function renderHero() {
  const last = allGames[0];
  if (last) {
    const el = document.getElementById('latest');
    el.href = `./game.html?slug=${encodeURIComponent(last.slug)}`;
    el.innerHTML = `
      ${last.cover ? `<img src="${last.cover}" alt="${escAttr(last.title)}">` : ''}
      <span class="cap mono"><b>${escHtml(last.title)}</b>Dernière partie${last.rating != null ? ` · ${last.rating} / 5` : ''}</span>`;
    el.hidden = false;
  }
  // Deux copies identiques : l'animation glisse de -50 % et boucle sans saut.
  const titles = allGames.slice(0, 8).map(g => `<span>${escHtml(g.title)} ✦</span>`).join('');
  document.getElementById('marquee').innerHTML = titles + titles;
}

// Même présentation que le bandeau de profil Backloggd : trois chiffres.
function renderStats() {
  const year = String(new Date().getFullYear());
  const inYear = allGames.filter(g =>
    (g.date || '').startsWith(year) || (g.date_start || '').startsWith(year)).length;
  const stats = [
    [allGames.length, '(A) Jeux joués'],
    [inYear, `(B) Joués en ${year}`],
    [allGames.filter(g => g.review).length, '(C) Critiques'],
  ];
  document.getElementById('stats').innerHTML = stats.map(([n, label]) => `
    <div class="cell">
      <span class="lab mono">${label}</span>
      <span class="stat-num">${String(n).padStart(3, '0')}</span>
    </div>`).join('');
}

function renderFavorites() {
  const favs = allGames
    .filter(g => g.favorite)
    .sort((a, b) => a.favorite - b.favorite);
  if (!favs.length) return;
  document.getElementById('fav-grid').innerHTML = favs.map((g, i) => cardHTML(g, i + 1)).join('');
  document.getElementById('favorites').hidden = false;
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

// Repris de l'icône « lignes de texte » que Backloggd pose sur les jeux critiqués.
const REVIEW_ICON = `
  <span class="card-icon" title="Critique écrite" aria-label="Critique écrite">
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="2"   width="12" height="1.6" rx="0.8"/>
      <rect x="1" y="5.4" width="12" height="1.6" rx="0.8"/>
      <rect x="1" y="8.8" width="12" height="1.6" rx="0.8"/>
      <rect x="1" y="12.2" width="7.5" height="1.6" rx="0.8"/>
    </svg>
  </span>`;

// Flèche circulaire, comme le marqueur « replay » du journal Backloggd.
const REPLAY_ICON = `
  <span class="card-icon" title="Rejoué" aria-label="Rejoué">
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5a5.5 5.5 0 1 1-5.2 3.7l1.5.5A3.9 3.9 0 1 0 7 3.1v1.9L3.9 2.3 7 -.4z"/>
    </svg>
  </span>`;

function cardHTML(game, rank) {
  const cover = game.cover
    ? `<img class="card-cover" src="${game.cover}" alt="${escAttr(game.title)}" loading="lazy">`
    : `<div class="card-cover-placeholder">${escHtml(game.title[0])}</div>`;

  return `
    <a class="game-card" href="./game.html?slug=${encodeURIComponent(game.slug)}">
      <div class="card-cover-wrap">${cover}${rank ? `<span class="card-rank mono">${String(rank).padStart(2, '0')}</span>` : ''}</div>
      <span class="card-title" title="${escAttr(game.title)}">${escHtml(game.title)}</span>
      <div class="card-meta mono">
        ${game.rating != null ? `<span class="note">★ ${game.rating}</span>` : ''}
        ${game.review ? REVIEW_ICON : ''}
        ${game.replay ? REPLAY_ICON : ''}
      </div>
    </a>`;
}

const REVIEW_FILTERS = [
  ['tous', 'Tous', () => true],
  ['avec', 'Avec critique', g => g.review],
  ['sans', 'Sans critique', g => !g.review],
];

function renderReviewFilter(list) {
  document.getElementById('review-filter').innerHTML = REVIEW_FILTERS.map(([key, texte, keep]) => `
    <button type="button" data-critique="${key}" aria-pressed="${key === currentReview}">${texte}<span>${list.filter(keep).length}</span></button>`).join('');
}

function render() {
  const searched = getFiltered();
  renderReviewFilter(searched);
  const filtered = searched.filter(REVIEW_FILTERS.find(f => f[0] === currentReview)[2]);
  const countEl = document.getElementById('results-count');
  const grid = document.getElementById('games-grid');

  countEl.textContent = currentSearch
    ? `${filtered.length} résultat${filtered.length !== 1 ? 's' : ''}`
    : '';

  // Le top 5 n'a rien à faire au-dessus d'une liste de résultats. Remettre
  // display à '' suffit : l'attribut hidden reprend la main s'il n'y a pas
  // de favoris.
  document.getElementById('favorites').style.display = currentSearch ? 'none' : '';

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state mono">Aucun jeu trouvé.</div>';
    return;
  }

  // Sur « Tous », les jeux critiqués d'abord, puis les autres — mais pas
  // pendant une recherche : on veut alors tous les résultats d'un bloc.
  const critiques = filtered.filter(g => g.review);
  const sansCritique = filtered.filter(g => !g.review);
  const scinde = !currentSearch && currentReview === 'tous' && critiques.length > 0 && sansCritique.length > 0;

  if (!scinde) {
    grid.innerHTML = filtered.map(g => cardHTML(g)).join('');
    return;
  }

  // Le filtre au-dessus tient lieu d'intitulé pour le premier groupe.
  grid.innerHTML = [
    critiques.map(g => cardHTML(g)).join(''),
    `<div class="grid-divider"><h3>Sans critique</h3><span class="mono">${sansCritique.length} jeux</span></div>`,
    sansCritique.map(g => cardHTML(g)).join(''),
  ].join('');
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

const sortEl = document.getElementById('sort');

// Rétablit ce que l'URL contenait au chargement.
searchEl.value = currentSearch;
sortEl.value = currentSort;

searchEl.addEventListener('input', e => {
  currentSearch = e.target.value;
  resetScrollMemory();
  syncURL();
  render();
});

sortEl.addEventListener('change', e => {
  currentSort = e.target.value;
  resetScrollMemory();
  syncURL();
  render();
});

// On ne mémorise la position qu'en partant vers la fiche d'un jeu. Toute autre
// sortie (logo, rechargement, lien externe) ne laisse rien derrière elle.
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('a.game-card')) rememberScroll();
}, true);

// Une recherche ou un tri repart du haut : garder l'ancienne position n'aurait
// aucun sens sur une liste dont le contenu vient de changer.
function resetScrollMemory() {
  try { sessionStorage.removeItem(SCROLL_KEY); } catch { /* rien à faire */ }
}

document.getElementById('review-filter').addEventListener('click', e => {
  const btn = e.target.closest('[data-critique]');
  if (!btn) return;
  currentReview = btn.dataset.critique;
  resetScrollMemory();
  syncURL();
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
    syncURL();
    render();
    searchEl.blur();
  }
});

init();
