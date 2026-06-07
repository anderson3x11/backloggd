const STATUS_LABELS = {
  completed: 'Terminé',
  playing: 'En cours',
  dropped: 'Abandonné',
  'on-hold': 'En pause',
};

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

async function init() {
  const slug = new URLSearchParams(window.location.search).get('slug');
  const page = document.getElementById('game-page');

  if (!slug) {
    renderNotFound(page);
    return;
  }

  let games;
  try {
    const res = await fetch('./data/games.json');
    games = await res.json();
  } catch {
    page.innerHTML = '<div class="not-found-wrap"><h2>Erreur</h2><p>Impossible de charger les données.</p></div>';
    return;
  }

  const game = games.find(g => g.slug === slug);
  if (!game) {
    renderNotFound(page);
    return;
  }

  document.title = `${game.title} — backloggd.`;
  page.innerHTML = renderGame(game);
}

function renderGame(game) {
  const cover = game.cover
    ? `<img class="game-cover-full" src="${game.cover}" alt="${escAttr(game.title)}">`
    : `<div class="game-cover-placeholder-full">${escHtml(game.title[0])}</div>`;

  const rating = game.rating != null
    ? `<div class="game-rating-large">${game.rating}<span class="denom">/5</span></div>`
    : '';

  const metaRows = [
    game.platform ? metaRow('Plateforme', escHtml(game.platform)) : '',
    game.hours != null ? metaRow('Durée', `${game.hours}h`) : '',
    buildDateRow(game),
    game.status ? metaRow('Statut', `<span class="status-badge ${game.status}">${STATUS_LABELS[game.status] || game.status}</span>`) : '',
  ].filter(Boolean).join('');

  const review = game.review ? `
    <hr class="divider">
    <div class="review-section">
      <div class="review-label">Critique</div>
      <div class="review-body">${formatReview(game.review)}</div>
    </div>` : '';

  return `
    <div class="game-layout">
      <div class="game-left">${cover}</div>
      <div class="game-right">
        <h1 class="game-title">${escHtml(game.title)}</h1>
        ${rating}
        <ul class="game-meta-list">${metaRows}</ul>
        ${review}
      </div>
    </div>`;
}

function buildDateRow(game) {
  const start = game.date_start;
  const end = game.date;

  if (!start && !end) return '';

  if (start && end) {
    if (start === end) {
      return metaRow('Fini en', formatDate(end));
    }
    const [sy, sm, sd] = start.split('-');
    const [ey, em, ed] = end.split('-');
    if (sm === em && sy === ey && sd && ed) {
      const range = `${parseInt(sd, 10)} — ${parseInt(ed, 10)} ${MONTHS_FR[parseInt(em, 10) - 1]} ${ey}`;
      return metaRow('Période', range);
    }
    return metaRow('Période', `${formatDate(start)} — ${formatDate(end)}`);
  }

  return metaRow('Fini en', formatDate(end || start));
}

function metaRow(key, value) {
  return `<li class="meta-row">
    <span class="meta-key">${key}</span>
    <span class="meta-val">${value}</span>
  </li>`;
}

function formatDate(date) {
  const parts = date.split('-');
  const year = parts[0];
  const month = parts[1] ? parseInt(parts[1], 10) : null;
  const day = parts[2] ? parseInt(parts[2], 10) : null;
  if (!month) return year;
  if (!day) return `${MONTHS_FR[month - 1]} ${year}`;
  return `${day} ${MONTHS_FR[month - 1]} ${year}`;
}

function formatReview(text) {
  return text
    .split('\n\n')
    .map(para => `<p>${escHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
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

function renderNotFound(page) {
  page.innerHTML = `
    <div class="not-found-wrap">
      <h2>Jeu introuvable.</h2>
      <p><a href="./index.html" style="color:var(--accent)">← retour à la liste</a></p>
    </div>`;
}

init();
