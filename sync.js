/*
 * Synchronise data/games.json avec le profil Backloggd.
 *
 *   node sync.js --dry     affiche les changements sans rien écrire
 *   node sync.js           applique les changements
 *   node sync.js --prune   retire aussi les jeux supprimés de Backloggd
 *
 * Les deux options se combinent : `node sync.js --dry --prune`.
 *
 * Ce que le script prend sur Backloggd (source de vérité) :
 *   - la note et la critique   (page /reviews)
 *   - les dates de début/fin   (page /journal, événements Started / Finished)
 *
 * Ce qu'il ne touche jamais sur un jeu déjà présent :
 *   - platform, cover, slug, title — pour préserver tes retouches manuelles
 *     (par exemple "PC (Mesen)" là où Backloggd dit "Famicom").
 *
 * Il n'efface jamais un jeu : une entrée absente de Backloggd est signalée,
 * pas supprimée.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const USER = 'kujayro';
const DATA = path.join(__dirname, 'data', 'games.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DRY = process.argv.includes('--dry');
const PRUNE = process.argv.includes('--prune');

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
const slugify = s => (s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cleanReview = t => t.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n').trim();
const big2x = u => (u || '').replace('/t_cover_big/', '/t_cover_big_2x/');

/* ---------- extracteurs exécutés dans la page ---------- */

const grabJournal = () => {
  const out = [];
  let month = null, year = null, day = null;
  for (const entry of document.querySelectorAll('.journal_entry')) {
    const head = entry.querySelector('.month-year-date h4');
    if (head) {
      const m = head.innerText.trim().match(/^(\w+),\s*(\d{4})$/);
      if (m) { month = m[1]; year = m[2]; }
    }
    // Backloggd n'affiche le numéro du jour que sur la première entrée d'une
    // date ; les suivantes ont la case vide et héritent du jour précédent.
    const cell = (entry.querySelector('.date-day') || { innerText: '' }).innerText.trim();
    if (/^\d{1,2}$/.test(cell)) day = cell;

    const link = entry.querySelector('.game-name a');
    if (!link || !month || !day) continue;
    const img = entry.querySelector('img.card-img');

    // Le libellé existe en double (desktop + mobile), la variante mobile
    // fusionnant les deux en « Started / Finished » — on ne garde que les
    // libellés exacts, dédoublonnés.
    const types = new Set();
    for (const t of entry.querySelectorAll('.journal-time')) {
      const v = t.innerText.trim().toLowerCase();
      if (v === 'started' || v === 'finished') types.add(v);
    }
    for (const type of types) {
      out.push({
        title: link.innerText.trim(),
        bgSlug: link.getAttribute('href').replace(/^\/games\/|\/$/g, ''),
        cover: img ? img.getAttribute('src') : null,
        platform: (entry.querySelector('.journal-platform') || {}).innerText || null,
        day, month, year, type,
      });
    }
  }
  return out;
};

const grabReviews = () => [...document.querySelectorAll('.review-card')].map(card => {
  const link = card.querySelector('a[href^="/games/"]');
  const img = card.querySelector('img.card-img');
  const top = card.querySelector('.stars-top');
  const time = card.querySelector('time[datetime]');
  const body = card.querySelector('.review-body');
  const pct = top ? parseFloat((top.getAttribute('style') || '').replace(/[^\d.]/g, '')) : NaN;
  return {
    title: img ? img.getAttribute('alt') : null,
    bgSlug: link ? link.getAttribute('href').replace(/^\/games\/|\/$/g, '') : null,
    rating: Number.isNaN(pct) ? null : pct / 20,
    date: time ? time.getAttribute('datetime').slice(0, 10) : null,
    review: body ? body.innerText.trim() : '',
  };
}).filter(r => r.bgSlug);

/* ---------- pagination ---------- */

async function scrapeAll(page, url, extractor, label) {
  const rows = [];
  const seen = new Set();
  for (let n = 1; n <= 40; n++) {
    await page.goto(`${url}?page=${n}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1800);
    const batch = await page.evaluate(extractor);
    if (!batch.length) break;
    // Au-delà de la dernière page, Backloggd renvoie en boucle la dernière —
    // on s'arrête dès qu'une page n'apporte plus rien de neuf.
    const fresh = batch.filter(r => {
      const k = JSON.stringify(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    process.stdout.write(`  ${label} page ${n}: ${fresh.length} nouveau(x)\n`);
    if (!fresh.length) break;
    rows.push(...fresh);
    await sleep(1200);
  }
  return rows;
}

/* ---------- assemblage ---------- */

function buildFromEvents(events) {
  const games = new Map();
  for (const e of events) {
    const mi = MONTHS.indexOf(e.month.toLowerCase());
    if (mi < 0) continue;
    const date = `${e.year}-${String(mi + 1).padStart(2, '0')}-${e.day.padStart(2, '0')}`;
    const key = norm(e.title);
    if (!games.has(key)) {
      games.set(key, { title: e.title, bgSlug: e.bgSlug, cover: e.cover, platform: e.platform, starts: [], finishes: [] });
    }
    const g = games.get(key);
    (e.type === 'finished' ? g.finishes : g.starts).push(date);
  }
  for (const g of games.values()) {
    g.starts.sort();
    g.finishes.sort();
    g.date = g.finishes.length ? g.finishes[g.finishes.length - 1] : null;
    // Le début retenu est le dernier "Started" antérieur ou égal à la fin.
    const before = g.date ? g.starts.filter(d => d <= g.date) : g.starts;
    g.date_start = before.length ? before[before.length - 1] : null;
  }
  return games;
}

function sortGames(list, originalIndex) {
  return [...list].sort((a, b) => {
    const aOpen = !a.date, bOpen = !b.date;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    const av = aOpen ? (a.date_start || '') : a.date;
    const bv = bOpen ? (b.date_start || '') : b.date;
    if (av !== bv) return av < bv ? 1 : -1;
    // À date égale, on conserve l'ordre actuel du fichier pour limiter le diff.
    return (originalIndex.get(a.slug) ?? 1e9) - (originalIndex.get(b.slug) ?? 1e9);
  });
}

/* ---------- programme ---------- */

(async () => {
  const existing = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const originalIndex = new Map(existing.map((g, i) => [g.slug, i]));

  console.log(`Lecture de backloggd.com/u/${USER} …`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  let events, reviews;
  try {
    events = await scrapeAll(page, `https://backloggd.com/u/${USER}/journal`, grabJournal, 'journal');
    reviews = await scrapeAll(page, `https://backloggd.com/u/${USER}/reviews`, grabReviews, 'reviews');
  } finally {
    await browser.close();
  }

  const journal = buildFromEvents(events);
  const byTitle = new Map(reviews.map(r => [norm(r.title), r]));
  const bySlug = new Map(reviews.map(r => [r.bgSlug, r]));

  const changes = [];
  const seenKeys = new Set();

  const merged = existing.map(g => {
    const j = journal.get(norm(g.title));
    const r = byTitle.get(norm(g.title)) || bySlug.get(g.slug);
    if (j) seenKeys.add(norm(g.title));

    const set = (field, value) => {
      if (value == null || g[field] === value) return;
      changes.push(`  ~ ${g.title} · ${field}: ${JSON.stringify(g[field])} → ${JSON.stringify(value)}`);
      g[field] = value;
    };

    if (j) {
      set('date_start', j.date_start);
      set('date', j.date);
    }
    if (r) {
      set('rating', r.rating);
      const rev = cleanReview(r.review);
      if (rev && g.review !== rev) {
        changes.push(`  ~ ${g.title} · critique (${(g.review || '').length} → ${rev.length} car.)`);
        g.review = rev;
      }
    }
    if (!j && !r) {
      g.__gone = true;
      changes.push(`  ${PRUNE ? '-' : '!'} ${g.title} — absent de Backloggd${PRUNE ? ', supprimé' : ' (--prune pour le retirer)'}`);
    }
    return g;
  }).filter(g => !(PRUNE && g.__gone));

  const usedSlugs = new Set(merged.map(g => g.slug));
  for (const [key, j] of journal) {
    if (seenKeys.has(key)) continue;
    let slug = slugify(j.title);
    while (usedSlugs.has(slug)) slug = slug + '-2';
    usedSlugs.add(slug);
    const r = byTitle.get(key) || bySlug.get(j.bgSlug);
    const game = { slug, title: j.title, cover: big2x(j.cover), platform: j.platform };
    if (r && r.rating != null) game.rating = r.rating;
    if (j.date_start) game.date_start = j.date_start;
    if (j.date) game.date = j.date;
    if (r && r.review) game.review = cleanReview(r.review);
    merged.push(game);
    changes.push(`  + ${j.title} (nouveau)`);
  }

  const ORDER = ['slug', 'title', 'cover', 'platform', 'rating', 'date_start', 'date', 'review'];
  const out = sortGames(merged, originalIndex)
    .map(g => Object.fromEntries(ORDER.filter(k => g[k] !== undefined && g[k] !== null).map(k => [k, g[k]])));

  console.log(`\n${changes.length} changement(s)`);
  console.log(changes.length ? changes.join('\n') : '  (rien à faire)');

  if (DRY) {
    console.log('\n--dry : aucun fichier écrit.');
  } else if (changes.length) {
    fs.writeFileSync(DATA, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nÉcrit : data/games.json (${out.length} jeux)`);
  } else {
    console.log('\nRien à écrire.');
  }
})();
