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

  // L'ordre du fichier est chronologique inverse : -1 = plus récent, +1 = plus ancien.
  const i = games.indexOf(game);
  const newer = games[i - 1];
  const older = games[i + 1];

  document.title = `${game.title} — backloggd.`;
  updateMeta(game);
  page.innerHTML = renderGame(game, newer, older);
  bindArrowKeys(newer, older);
}

function gameURL(game) {
  return `./game.html?slug=${encodeURIComponent(game.slug)}`;
}

function updateMeta(game) {
  const summary = game.review
    ? game.review.replace(/\s+/g, ' ').slice(0, 180).trim() + '…'
    : `${game.title} dans le journal de anderson3x11.`;
  const note = game.rating != null ? ` — ${game.rating}/5` : '';

  setMeta('name', 'description', summary);
  setMeta('property', 'og:title', `${game.title}${note}`);
  setMeta('property', 'og:description', summary);
  if (game.cover) setMeta('property', 'og:image', game.cover);
}

function setMeta(attr, key, value) {
  const el = document.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.setAttribute('content', value);
}

function bindArrowKeys(newer, older) {
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft' && newer) window.location.href = gameURL(newer);
    if (e.key === 'ArrowRight' && older) window.location.href = gameURL(older);
  });
}

function starsHTML(rating) {
  const pct = rating == null ? 0 : Math.max(0, Math.min(100, (rating / 5) * 100));
  const label = rating == null ? 'non noté' : `${rating} sur 5`;
  return `<span class="stars stars--lg" role="img" aria-label="${label}">` +
    `<span class="stars-bg">★★★★★</span>` +
    `<span class="stars-fg" style="width:${pct}%">★★★★★</span>` +
    `</span>`;
}

function navLink(game, dir) {
  // Aux extrémités de la liste, on n'affiche rien.
  if (!game) return '';
  return `
    <a class="game-nav-item ${dir}" href="${gameURL(game)}">
      <span class="game-nav-arrow">${dir === 'newer' ? '←' : '→'}</span>
      <span class="game-nav-title">${escHtml(game.title)}</span>
    </a>`;
}

function renderGame(game, newer, older) {
  const cover = game.cover
    ? `<img class="game-cover-full" src="${game.cover}" alt="${escAttr(game.title)}">`
    : `<div class="game-cover-placeholder-full">${escHtml(game.title[0])}</div>`;

  const sub = [
    buildDateText(game),
    game.platform ? escHtml(game.platform) : '',
  ].filter(Boolean).join('<span class="sep">/</span>');

  const rating = `
    <div class="rating-bare">
      <div class="panel-label">Note</div>
      <div class="rating-row">
        ${starsHTML(game.rating)}
        ${game.rating != null
          ? `<span class="rating-num"><b>${game.rating}</b> / 5</span>`
          : '<span class="stars-none">pas encore noté</span>'}
      </div>
    </div>`;

  const review = `
    <div class="panel section">
      <div class="panel-label">Critique</div>
      ${game.review
        ? `<div class="review-body">${formatReview(game.review)}</div>`
        : '<div class="review-empty">Pas encore de critique pour ce jeu.</div>'}
    </div>`;

  return `
    <div class="game-layout">
      <div class="game-left">
        <div class="panel cover-frame">${cover}</div>
        ${newer || older ? `
        <nav class="game-nav${newer && older ? '' : ' is-single'}">
          ${navLink(newer, 'newer')}
          ${navLink(older, 'older')}
        </nav>` : ''}
      </div>
      <div class="game-right">
        <div class="game-head">
          <h1 class="game-title">${escHtml(game.title)}</h1>
          ${sub ? `<div class="game-sub">${sub}</div>` : ''}
        </div>
        ${rating}
        ${review}
      </div>
    </div>`;
}

function buildDateText(game) {
  const start = game.date_start;
  const end = game.date;

  if (!start && !end) return '';

  if (start && end && start !== end) {
    const [sy, sm, sd] = start.split('-');
    const [ey, em, ed] = end.split('-');
    if (sy === ey && sm === em && sd && ed) {
      return `${parseInt(sd, 10)} — ${parseInt(ed, 10)} ${MONTHS_FR[parseInt(em, 10) - 1]} ${ey}`;
    }
    return `${formatDate(start)} — ${formatDate(end)}`;
  }

  if (!end && start) return `Depuis le ${formatDate(start)}`;

  // Played in a single day (or only one date known) — the bare date says it.
  return formatDate(end);
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
      <p><a class="back-link" href="./index.html">← retour à la liste</a></p>
    </div>`;
}

init();
