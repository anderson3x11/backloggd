const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

// Si on arrive depuis la liste, « ← Retour » ramène à la liste telle qu'elle
// était (recherche et tri compris) plutôt qu'à l'accueil par défaut.
function restoreBackLink() {
  const back = document.querySelector('nav .back');
  if (!back || !document.referrer) return;
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === window.location.origin && /(^|\/)index\.html$|\/$/.test(ref.pathname)) {
      back.href = ref.href;
    }
  } catch {
    /* referrer inexploitable : on garde le lien par défaut */
  }
}

async function init() {
  restoreBackLink();
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
    page.innerHTML = '<div class="not-found"><h1>Erreur</h1><p>Impossible de charger les données.</p></div>';
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

  document.title = `${game.title} - Journal de jeux`;
  updateMeta(game);
  page.innerHTML = renderGame(game, newer, older, i, games.length);
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
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  return `<span class="stars" role="img" aria-label="${rating} sur 5">★★★★★` +
    `<span class="stars-fg" style="width:${pct}%">★★★★★</span></span>`;
}

function fact(key, value) {
  return value ? `<div><dt class="mono">${key}</dt><dd>${value}</dd></div>` : '';
}

// Bas de page : jeu précédent / suivant en grand, comme le « projet suivant »
// des études de cas du portfolio.
function nextLink(game, dir) {
  if (!game) return '<span></span>';
  return `
    <a href="${gameURL(game)}">
      <span class="mono">${dir === 'newer' ? '← Plus récent' : 'Plus ancien →'}</span>
      <strong>${escHtml(game.title)}</strong>
    </a>`;
}

// Le titre doit tenir dans sa colonne sans couper de mot : la taille dépend
// du mot le plus long, et les titres à rallonge restent plus sobres.
function titleSize(title) {
  const longest = Math.max(...title.split(/\s+/).map(w => w.length));
  return `--w:${longest};--cap:${title.length > 24 ? 'min(120px, 22cqi)' : '200px'}`;
}

function renderGame(game, newer, older, index, total) {
  const cover = game.cover
    ? `<img src="${game.cover}" alt="${escAttr(game.title)}">`
    : '';

  const rating = game.rating != null
    ? `${starsHTML(game.rating)}<span class="rating-num">${game.rating}<small> / 5</small></span>`
    : '<span class="stars-none mono">Pas encore noté</span>';

  const facts = [
    fact('Joué', buildDateText(game)),
    fact('Plateforme', game.platform ? escHtml(game.platform) + (game.replay ? ' <span class="replay">· ↺ Rejoué</span>' : '') : ''),
    fact('Sortie', game.year ? escHtml(game.year) : ''),
    fact('Studio', game.developer ? escHtml(game.developer) : ''),
    fact('Genre', game.genres && game.genres.length ? escHtml(game.genres.slice(0, 3).join(', ')) : ''),
    fact('Support', game.platforms && game.platforms.length ? escHtml(game.platforms.slice(0, 4).join(', ')) : ''),
  ].join('');

  // Lettrage (A), (B)… comme les cellules du portfolio, sans trou quand une
  // section manque.
  const letters = 'BCD';
  let n = 0;
  const section = (label, body) => `
    <div class="row full">
      <div class="cell">
        <span class="lab mono">(${letters[n++]}) ${label}</span>
        ${body}
      </div>
    </div>`;

  return `
    <div class="row">
      <div class="cell">
        <div class="cap mono"><span>(A) Journal</span><span>${String(index + 1).padStart(3, '0')} / ${total}</span></div>
        <h1 class="title" style="${titleSize(game.title)}">${escHtml(game.title)}</h1>
        <div class="rating">${rating}</div>
        <dl class="facts">${facts}</dl>
      </div>
      <div class="cell media">${cover}</div>
    </div>
    ${game.review ? section('Critique', `<div class="prose">${formatReview(game.review)}</div>`) : ''}
    ${game.summary ? section('Résumé', `<p class="summary">${escHtml(game.summary)}</p>`) : ''}
    ${newer || older ? `<div class="next">${nextLink(newer, 'newer')}${nextLink(older, 'older')}</div>` : ''}`;
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
    <div class="not-found">
      <h1>Jeu introuvable</h1>
      <a class="pill mono" href="./index.html">← Retour au journal</a>
    </div>`;
}

init();
