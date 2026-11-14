const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

// Si on arrive depuis la liste, « ← Retour » ramène à la liste telle qu'elle
// était (recherche et tri compris) plutôt qu'à l'accueil par défaut.
function restoreBackLink() {
  const back = document.querySelector('header .nav-link');
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

  document.title = `${game.title} - backloggd`;
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
  const pct = rating == null ? 0 : Math.max(0, Math.min(100, (rating / 5) * 100));
  const label = rating == null ? 'non noté' : `${rating} sur 5`;
  return `<span class="stars stars--lg" role="img" aria-label="${label}">` +
    `<span class="stars-bg">★★★★★</span>` +
    `<span class="stars-fg" style="width:${pct}%">★★★★★</span>` +
    `</span>`;
}

// Le titre doit tenir dans sa cellule sans couper de mot : la taille suit le
// mot le plus long, et les titres à rallonge restent plus sobres.
function titleSize(title) {
  const longest = Math.max(...title.split(/\s+/).map(w => w.length));
  return `--w:${longest};--cap:${title.length > 24 ? 'min(72px, 14cqi)' : '104px'}`;
}

function fact(key, value) {
  return value ? `<div><dt>${key}</dt><dd>${value}</dd></div>` : '';
}

// Bas de page : précédent / suivant en grand, comme le « projet suivant »
// des études de cas du portfolio.
function nextCell(game, dir) {
  if (!game) return '<div class="cell"></div>';
  return `
    <a class="cell next-link ${dir}" href="${gameURL(game)}">
      <span class="lab">${dir === 'newer' ? '← Précédent' : 'Suivant →'}</span>
      <strong>${escHtml(game.title)}</strong>
    </a>`;
}

function renderGame(game, newer, older, index, total) {
  const cover = game.cover
    ? `<img src="${game.cover}" alt="${escAttr(game.title)}">`
    : `<div class="game-cover-placeholder-full">${escHtml(game.title[0])}</div>`;

  const rating = game.rating != null ? `
    <div class="rating-block">
      <span class="rating-big">${game.rating}</span>
      <span class="rating-of">/ 5</span>
      ${starsHTML(game.rating)}
    </div>` : '<div class="rating-block"><span class="stars-none">Pas encore noté</span></div>';

  const facts = [
    fact('Joué', buildDateText(game)),
    fact('Plateforme', game.platform ? escHtml(game.platform) + (game.replay ? ' <span class="replay">↺ Rejoué</span>' : '') : ''),
    fact('Sortie', game.year ? escHtml(game.year) : ''),
    fact('Studio', game.developer ? escHtml(game.developer) : ''),
    fact('Genre', game.genres && game.genres.length ? escHtml(game.genres.slice(0, 3).join(', ')) : ''),
    fact('Support', game.platforms && game.platforms.length ? escHtml(game.platforms.slice(0, 4).join(', ')) : ''),
  ].join('');

  // Lettrage (B), (C)… comme les cellules du portfolio, sans trou quand une
  // section manque.
  let n = 0;
  const letter = () => `(${'BCDE'[n++]})`;

  // Avec une critique : les infos du jeu à gauche (collantes), la critique à
  // droite sur toute la hauteur. Sans critique, fiche et résumé se partagent
  // la rangée.
  const ficheHTML = `<div class="side-block"><span class="lab">${letter()} Fiche</span><dl class="facts">${facts}</dl></div>`;
  const summaryHTML = game.summary
    ? `<div class="side-block"><span class="lab">${letter()} Résumé</span><p class="game-summary">${escHtml(game.summary)}</p></div>`
    : '';
  const body = game.review
    ? `<div class="cell side"><div class="side-inner">${ficheHTML}${summaryHTML}</div></div>
       <div class="cell"><span class="lab">${letter()} Critique</span><div class="review-body">${formatReview(game.review)}</div></div>`
    : `<div class="cell">${ficheHTML}</div><div class="cell">${summaryHTML}</div>`;

  // Jaquette floutée derrière le bandeau, teintée de bleu.
  const backdrop = game.cover
    ? `<div class="head-bg" aria-hidden="true" style="background-image:url('${escAttr(game.cover)}')"></div>`
    : '';

  return `
    <div class="row head">
      ${backdrop}
      <div class="cell media">${cover}</div>
      <div class="cell">
        <div class="cap"><span>(A) Journal</span><span>${String(index + 1).padStart(3, '0')} / ${total}</span></div>
        <h1 class="game-title" style="${titleSize(game.title)}">${escHtml(game.title)}</h1>
        ${rating}
      </div>
    </div>
    <div class="row">${body}</div>
    ${newer || older ? `<div class="row next">${nextCell(newer, 'newer')}${nextCell(older, 'older')}</div>` : ''}`;
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
