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
  bindGallery(game);
  markClippedSummary();
  window.addEventListener('resize', markClippedSummary);
  bindSummaryDialog();
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

// Le résumé prend la place qui reste dans la colonne : on ne le fond en bas
// que s'il déborde vraiment.
function markClippedSummary() {
  const p = document.querySelector('.game-summary');
  if (p) p.classList.toggle('is-clipped', p.scrollHeight > p.clientHeight + 1);
}

// « Lire la suite » ouvre le résumé complet : le déplier sur place ferait
// déborder la colonne, calée sur la hauteur de l'écran.
function bindSummaryDialog() {
  const dialog = document.getElementById('summary-dialog');
  if (!dialog) return;
  document.getElementById('summary-more').addEventListener('click', () => dialog.showModal());
  document.getElementById('summary-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}

function bindArrowKeys(newer, older) {
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Visionneuse ouverte : les flèches font défiler les images, pas les jeux.
    if (document.querySelector('dialog[open]')) return;
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

// Icônes en SVG plutôt qu'en caractères : un glyphe « ← » se décale selon la
// police, un tracé reste centré dans le bouton rond.
const ICON = {
  prev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3M7 4 3 8l4 4"/></svg>',
  next: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};

const IGDB = 'https://images.igdb.com/igdb/image/upload';
const shotURL = (id, size) => `${IGDB}/${size}/${id}.jpg`;

// Carrousel : défilement natif (scroll-snap), les flèches avancent d'une image.
// Un clic ouvre la visionneuse, un <dialog> natif : Échap le ferme tout seul.
function bindGallery(game) {
  const shots = game.screenshots || [];
  const track = document.getElementById('shots');
  const dialog = document.getElementById('viewer');
  if (!track || !dialog) return;

  const img = dialog.querySelector('img');
  const count = dialog.querySelector('.viewer-count');
  let current = 0;
  const show = i => {
    current = (i + shots.length) % shots.length;
    // lazy évite de télécharger la 1080p avant l'ouverture, mais Chrome ne la
    // charge jamais dans un <dialog> qui s'ouvre : on repasse en eager ici.
    img.loading = 'eager';
    img.src = shotURL(shots[current], 't_1080p');
    count.textContent = `${current + 1} / ${shots.length}`;
  };

  track.addEventListener('click', e => {
    const btn = e.target.closest('[data-shot]');
    if (!btn) return;
    show(Number(btn.dataset.shot));
    dialog.showModal();
  });

  document.querySelectorAll('[data-scroll]').forEach(btn => btn.addEventListener('click', () => {
    const step = track.querySelector('.shot').offsetWidth + 16;
    track.scrollBy({ left: step * Number(btn.dataset.scroll), behavior: 'smooth' });
  }));

  dialog.querySelector('.viewer-prev').addEventListener('click', () => show(current - 1));
  dialog.querySelector('.viewer-next').addEventListener('click', () => show(current + 1));
  dialog.querySelector('.viewer-close').addEventListener('click', () => dialog.close());
  // Un clic sur le fond (le dialog lui-même, hors de l'image) ferme aussi.
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') show(current - 1);
    if (e.key === 'ArrowRight') show(current + 1);
  });
}

function galleryHTML(game, label) {
  const shots = game.screenshots || [];
  if (!shots.length) return '';
  const items = shots.map((id, i) => `
    <button type="button" class="shot" data-shot="${i}" aria-label="Agrandir l'image ${i + 1}">
      <img src="${shotURL(id, 't_screenshot_big')}" alt="" loading="lazy">
    </button>`).join('');
  return `
    <div class="row full gallery">
      <div class="cell">
        <div class="gallery-head">
          <span class="lab">${label} Images</span>
          ${shots.length > 2 ? `<div class="gallery-nav">
            <button type="button" class="round" data-scroll="-1" aria-label="Images précédentes">${ICON.prev}</button>
            <button type="button" class="round" data-scroll="1" aria-label="Images suivantes">${ICON.next}</button>
          </div>` : ''}
        </div>
        <div class="shots" id="shots">${items}</div>
      </div>
    </div>
    <dialog class="viewer" id="viewer" aria-label="Images du jeu">
      <img src="${shotURL(shots[0], 't_1080p')}" alt="Capture d'écran de ${escAttr(game.title)}" loading="lazy">
      <button type="button" class="round viewer-prev" aria-label="Image précédente">${ICON.prev}</button>
      <button type="button" class="round viewer-next" aria-label="Image suivante">${ICON.next}</button>
      <button type="button" class="round viewer-close" aria-label="Fermer">${ICON.close}</button>
      <span class="viewer-count"></span>
    </dialog>`;
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
  const letter = () => `(${'BCDEF'[n++]})`;

  // Colonne de gauche : l'en-tête du jeu, puis la fiche et le résumé, calée
  // sur la hauteur de l'écran. Colonne de droite : la critique.
  // Le fond de l'en-tête est une capture tirée au hasard à chaque chargement,
  // comme sur Backloggd ; la jaquette sert de repli.
  const shots = game.screenshots || [];
  const bg = shots.length ? shotURL(shots[Math.floor(Math.random() * shots.length)], 't_screenshot_big') : game.cover;
  const backdrop = bg
    ? `<div class="head-bg" aria-hidden="true" style="background-image:url('${escAttr(bg)}')"></div>`
    : '';
  const head = `
    <div class="game-head">
      ${backdrop}
      <div class="cap"><span>(A) Journal</span><span>${String(index + 1).padStart(3, '0')} / ${total}</span></div>
      <div class="head-main">
        <div class="head-cover">${cover}</div>
        <div class="head-text">
          <h1 class="game-title" style="${titleSize(game.title)}">${escHtml(game.title)}</h1>
          ${rating}
        </div>
      </div>
    </div>`;
  const fiche = `<div class="side-block"><span class="lab">${letter()} Fiche</span><dl class="facts">${facts}</dl></div>`;
  const summary = game.summary
    ? `<div class="side-block">
        <span class="lab">${letter()} Résumé</span>
        <p class="game-summary">${escHtml(game.summary)}</p>
        <button type="button" class="summary-more" id="summary-more">Lire la suite</button>
        <dialog class="summary-dialog" id="summary-dialog" aria-label="Résumé">
          <div class="summary-dialog-head">
            <span class="lab">Résumé</span>
            <button type="button" class="round" id="summary-close" aria-label="Fermer">${ICON.close}</button>
          </div>
          <p>${escHtml(game.summary)}</p>
        </dialog>
      </div>`
    : '';
  const review = game.review
    ? `<div class="cell review"><span class="lab">${letter()} Critique</span><div class="review-body">${formatReview(game.review)}</div></div>`
    : '<div class="cell review is-empty"><span class="lab">Pas encore de critique</span></div>';

  return `
    <div class="row split">
      <div class="side">${head}${fiche}${summary}</div>
      ${review}
    </div>
    ${galleryHTML(game, letter())}
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
