let allGames = [];
let currentSearch = '';

async function init() {
  try {
    const res = await fetch('./data/games.json');
    allGames = await res.json();
  } catch {
    document.getElementById('games-grid').innerHTML =
      '<div class="empty-state">Impossible de charger les jeux.</div>';
    return;
  }
  updateStats();
  render();
}

function updateStats() {
  const thisYear = new Date().getFullYear().toString();
  const playing = allGames.find(g => g.status === 'playing');
  const completed = allGames.filter(g => g.status === 'completed').length;
  const completedThisYear = allGames.filter(g =>
    g.status === 'completed' && g.date && g.date.startsWith(thisYear)
  ).length;

  document.getElementById('stat-playing').textContent = playing ? playing.title : '—';
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-year').textContent = completedThisYear;
}

function getFiltered() {
  const q = currentSearch.toLowerCase();
  return allGames.filter(g =>
    !q || g.title.toLowerCase().includes(q)
  );
}

function cardHTML(game) {
  const cover = game.cover
    ? `<img class="card-cover" src="${game.cover}" alt="${escAttr(game.title)}" loading="lazy">`
    : `<div class="card-cover-placeholder">${escHtml(game.title[0])}</div>`;

  return `
    <a class="game-card" href="./game.html?slug=${encodeURIComponent(game.slug)}">
      <div class="card-cover-wrap">${cover}</div>
      <div class="card-title" title="${escAttr(game.title)}">${escHtml(game.title)}</div>
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

document.getElementById('search').addEventListener('input', e => {
  currentSearch = e.target.value;
  render();
});

init();
