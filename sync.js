/*
 * Synchronise data/games.json avec le profil Backloggd.
 *
 *   node sync.js --dry     affiche les changements sans rien écrire
 *   node sync.js           applique les changements
 *   node sync.js --prune   retire aussi les jeux supprimés de Backloggd
 *   node sync.js --details=40   ne complète que 40 fiches de jeu ce tour-ci
 *
 * Les options se combinent : `node sync.js --dry --prune`.
 *
 * La récupération des fiches (studio, année, genres, résumé) coûte une requête
 * par jeu. Elle est reprenable : le fichier est réécrit tous les 10 jeux, et
 * chaque exécution ne traite que ceux à qui il manque encore les infos.
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

// Nombre de fiches de jeu récupérées par exécution, et intervalle entre deux
// requêtes. Backloggd n'est pas rapide : on reste volontairement lent.
const detailsArg = (process.argv.find(a => a.startsWith('--details=')) || '').split('=')[1];
const DETAILS = detailsArg ? parseInt(detailsArg, 10) : Infinity;
const DETAIL_DELAY = 2500;

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

// Grille de tous les jeux joués : la note y est portée par data-rating, sur une
// échelle /10. Pas de plateforme ni de date ici, seulement note et jaquette.
const grabLibrary = () => [...document.querySelectorAll('.game-cover')].map(c => {
  const link = c.querySelector('a[href^="/games/"]');
  const img = c.querySelector('img.card-img');
  const dr = c.getAttribute('data-rating');
  return {
    title: img ? img.getAttribute('alt') : null,
    bgSlug: link ? link.getAttribute('href').replace(/^\/games\//, '').replace(/\/$/, '') : null,
    cover: img ? img.getAttribute('src') : null,
    rating: dr ? parseFloat(dr) / 2 : null,
  };
}).filter(g => g.bgSlug && g.title);

// Les 5 favoris occupent la rangée qui contient le favori couronné
// (.ultimate_fav) sur la page de profil.
const grabFavorites = () => {
  const crown = document.querySelector('.ultimate_fav');
  if (!crown || !crown.parentElement) return [];
  return [...crown.parentElement.querySelectorAll('.game-cover')].map(c => {
    const link = c.querySelector('a[href^="/games/"]');
    const img = c.querySelector('img');
    return {
      bgSlug: link ? link.getAttribute('href').replace(/^\/games\//, '').replace(/\/$/, '') : null,
      title: img ? img.getAttribute('alt') : null,
      ultimate: !!c.closest('.ultimate_fav'),
    };
  }).filter(g => g.bgSlug);
};

// Fiche d'un jeu : studio, année, genres, plateformes d'existence, résumé.
// Tout est rendu deux fois (desktop + mobile), d'où les dédoublonnages.
const grabGamePage = () => {
  const uniq = a => [...new Set(a.map(s => s.trim()).filter(Boolean))];
  const studios = uniq([...document.querySelectorAll('.game-subtitle a[href*="/company/"]')]
    .map(a => a.innerText));
  const releaseLink = document.querySelector('a[href*="release_year:"]');
  const yearMatch = releaseLink && releaseLink.innerText.match(/(\d{4})/);
  // Le résumé est le premier vrai paragraphe hors bannière de consentement.
  const summary = [...document.querySelectorAll('p.mb-0')]
    .map(p => (p.innerText || '').trim())
    .find(t => t.length > 60 && !/cookie|consent|identifiers|vendors/i.test(t));

  return {
    developer: studios[0] || null,
    year: yearMatch ? yearMatch[1] : null,
    genres: uniq([...document.querySelectorAll('a[href*="genre"]')].map(a => a.innerText)),
    platforms: uniq([...document.querySelectorAll('.game-page-platform')].map(a => a.innerText)),
    summary: summary || null,
  };
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

// Tout est indexé par le slug Backloggd, jamais par le titre : Backloggd
// héberge l'original et le remake sous un titre identique (Resident Evil,
// Resident Evil 2, God of War…), et une clé par titre en écrase un des deux.
function buildFromEvents(events) {
  const games = new Map();
  for (const e of events) {
    const mi = MONTHS.indexOf(e.month.toLowerCase());
    if (mi < 0) continue;
    const date = `${e.year}-${String(mi + 1).padStart(2, '0')}-${e.day.padStart(2, '0')}`;
    const key = e.bgSlug;
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

// Un jeu en cours (commencé, pas fini) n'a ni note ni critique : il n'a rien à
// montrer et se retrouverait en tête de liste. On l'exclut du fichier ; il y
// entrera de lui-même à la prochaine synchro une fois terminé.
const enCours = g => !!g.date_start && !g.date;

// 0 = terminé et daté, 1 = noté sans aucune date (antérieur au journal).
function bucket(g) {
  return g.date ? 0 : 1;
}

function sortGames(list, originalIndex, libIndex) {
  return [...list].sort((a, b) => {
    const ab = bucket(a), bb = bucket(b);
    if (ab !== bb) return ab - bb;
    if (ab === 1) {
      // Sans date, on garde l'ordre de la bibliothèque Backloggd.
      return (libIndex.get(a.bg) ?? 1e9) - (libIndex.get(b.bg) ?? 1e9);
    }
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
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

  let events, reviews, library, favorites = [];
  try {
    events = await scrapeAll(page, `https://backloggd.com/u/${USER}/journal`, grabJournal, 'journal');
    reviews = await scrapeAll(page, `https://backloggd.com/u/${USER}/reviews`, grabReviews, 'reviews');
    library = await scrapeAll(page, `https://backloggd.com/u/${USER}/games`, grabLibrary, 'jeux   ');
    await page.goto(`https://backloggd.com/u/${USER}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2200);
    favorites = await page.evaluate(grabFavorites);
    console.log(`  favoris     : ${favorites.length}`);
  } finally {
    await browser.close();
  }

  // Page anti-bot ou structure changée : rien lu, donc rien à écrire.
  if (!library.length) {
    console.error('Aucun jeu lu sur Backloggd (anti-bot ?). Fichier non modifié.');
    process.exit(1);
  }

  const journal = buildFromEvents(events);
  const revBySlug = new Map(reviews.map(r => [r.bgSlug, r]));
  const libBySlug = new Map(library.map(g => [g.bgSlug, g]));
  const libIndex = new Map(library.map((g, i) => [g.bgSlug, i]));

  // norm(titre) → liste des slugs Backloggd portant ce titre.
  const titleToSlugs = new Map();
  for (const s of new Set([...libBySlug.keys(), ...journal.keys()])) {
    const t = norm((libBySlug.get(s) || journal.get(s)).title);
    if (!titleToSlugs.has(t)) titleToSlugs.set(t, []);
    titleToSlugs.get(t).push(s);
  }

  // Retrouve à quel jeu Backloggd correspond une entrée du fichier. Le champ
  // `bg` stocké fait foi : sans lui, deux jeux homonymes (original / remake)
  // seraient indiscernables au passage suivant et redupliqués.
  const ambigus = [];
  function resolve(g) {
    if (g.bg && (libBySlug.has(g.bg) || journal.has(g.bg))) return g.bg;
    const key = norm(g.title);
    const candidates = titleToSlugs.get(key) || [];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      const viaReview = reviews.find(r => norm(r.title) === key);
      if (viaReview && candidates.includes(viaReview.bgSlug)) return viaReview.bgSlug;
      ambigus.push(`${g.title} (${candidates.join(', ')})`);
      return null;
    }
    return null;
  }

  const changes = [];
  const seenKeys = new Set();

  const merged = existing.map(g => {
    const bg = resolve(g);
    const j = bg ? journal.get(bg) : null;
    const r = bg ? revBySlug.get(bg) : null;
    const l = bg ? libBySlug.get(bg) : null;
    if (bg) { seenKeys.add(bg); g.bg = bg; }

    const set = (field, value) => {
      if (value == null || g[field] === value) return;
      changes.push(`  ~ ${g.title} · ${field}: ${JSON.stringify(g[field])} → ${JSON.stringify(value)}`);
      g[field] = value;
    };

    if (j) {
      set('date_start', j.date_start);
      set('date', j.date);
    }
    // La note vient de la grille /games (elle couvre aussi les jeux sans
    // critique) ; la page reviews sert de repli.
    if (l) set('rating', l.rating);
    else if (r) set('rating', r.rating);
    if (r) {
      const rev = cleanReview(r.review);
      if (rev && g.review !== rev) {
        changes.push(`  ~ ${g.title} · critique (${(g.review || '').length} → ${rev.length} car.)`);
        g.review = rev;
      }
    }
    if (!j && !r && !l) {
      g.__gone = true;
      changes.push(`  ${PRUNE ? '-' : '!'} ${g.title} — absent de Backloggd${PRUNE ? ', supprimé' : ' (--prune pour le retirer)'}`);
    }
    return g;
  }).filter(g => !(PRUNE && g.__gone));

  // On parcourt toute la bibliothèque, pas seulement le journal : les jeux notés
  // avant que l'utilisateur ne commence à logger n'ont aucune entrée de journal.
  const usedSlugs = new Set(merged.map(g => g.slug));
  const candidates = new Map();
  for (const [bg, j] of journal) candidates.set(bg, { j, l: libBySlug.get(bg) });
  for (const [bg, l] of libBySlug) if (!candidates.has(bg)) candidates.set(bg, { j: null, l });

  let ajoutsSansDate = 0;
  for (const [bg, { j, l }] of candidates) {
    if (seenKeys.has(bg)) continue;
    const title = (j || l).title;
    // En cas d'homonyme (original vs remake), on retombe sur le slug Backloggd,
    // unique et stable : « resident-evil--3 » plutôt qu'un « resident-evil-2-2 »
    // qu'on confondrait avec Resident Evil 2.
    let slug = slugify(title);
    if (usedSlugs.has(slug)) slug = bg;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${bg}-${n++}`;
    usedSlugs.add(slug);

    const r = revBySlug.get(bg);
    const game = { slug, title, cover: big2x((j && j.cover) || (l && l.cover)) };
    if (j && j.platform) game.platform = j.platform;
    if (l && l.rating != null) game.rating = l.rating;
    else if (r && r.rating != null) game.rating = r.rating;
    if (j && j.date_start) game.date_start = j.date_start;
    if (j && j.date) game.date = j.date;
    if (r && r.review) game.review = cleanReview(r.review);

    game.bg = bg;
    merged.push(game);
    if (game.date) changes.push(`  + ${title} (nouveau)`);
    else if (!enCours(game)) ajoutsSansDate++;
  }
  if (ajoutsSansDate) {
    changes.push(`  + ${ajoutsSansDate} jeux notés sans entrée de journal (antérieurs au journal), ajoutés en fin de liste`);
  }
  if (ambigus.length) {
    changes.push(`  ? ${ambigus.length} titre(s) ambigu(s), note et dates laissées intactes : ${ambigus.join(' ; ')}`);
  }

  const exclus = merged.filter(enCours);
  for (const g of exclus) changes.push(`  · ${g.title} — en cours, non publié`);

  // Rang des favoris : 1 à 5 dans l'ordre d'affichage de Backloggd.
  const favRank = new Map(favorites.map((f, i) => [f.bgSlug, i + 1]));
  for (const g of merged) {
    const rank = g.bg ? favRank.get(g.bg) : undefined;
    if (g.favorite !== rank) {
      changes.push(rank
        ? `  ★ ${g.title} — favori nº${rank}`
        : `  ☆ ${g.title} — n'est plus un favori`);
    }
    if (rank) g.favorite = rank; else delete g.favorite;
  }
  if (favorites.length && favorites.length !== 5) {
    changes.push(`  ? ${favorites.length} favoris trouvés au lieu de 5 — vérifier la page de profil`);
  }

  const ORDER = ['slug', 'bg', 'title', 'cover', 'year', 'developer', 'genres', 'platforms',
    'platform', 'rating', 'favorite', 'replay', 'date_start', 'date', 'summary', 'review'];
  const serialise = () => sortGames(merged.filter(g => !enCours(g)), originalIndex, libIndex)
    .map(g => Object.fromEntries(ORDER.filter(k => g[k] !== undefined && g[k] !== null).map(k => [k, g[k]])));

  // Fiches de jeu : une requête chacune, donc réservée à ceux dont les infos
  // manquent encore. On écrit au fil de l'eau — une interruption ne doit pas
  // jeter le travail déjà fait, et le passage suivant reprend où on s'est
  // arrêté. --details=N limite le nombre de fiches par exécution.
  const aCompleter = merged.filter(g => !enCours(g) && g.bg && !g.developer && !g.summary);
  const lot = aCompleter.slice(0, DETAILS);
  if (lot.length && !DRY) {
    console.log(`\nInfos manquantes : ${aCompleter.length} jeu(x). Traitement de ${lot.length} ce tour, une requête toutes les ${(DETAIL_DELAY / 1000).toFixed(1)} s.`);
    const browser2 = await chromium.launch();
    const ctx2 = await browser2.newContext({ userAgent: UA });
    const page2 = await ctx2.newPage();
    let faits = 0;
    try {
      for (let i = 0; i < lot.length; i++) {
        const g = lot[i];
        try {
          await page2.goto(`https://backloggd.com/games/${g.bg}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page2.waitForTimeout(1200);
          const d = await page2.evaluate(grabGamePage);
          if (d.developer) g.developer = d.developer;
          if (d.year) g.year = d.year;
          if (d.genres && d.genres.length) g.genres = d.genres.slice(0, 3);
          if (d.platforms && d.platforms.length) g.platforms = d.platforms.slice(0, 6);
          if (d.summary) g.summary = d.summary;
          faits++;
        } catch {
          console.log(`  ! ${g.title} — fiche illisible, ignorée`);
        }
        // Sauvegarde régulière : c'est ce qui rend l'opération reprenable.
        if ((i + 1) % 10 === 0 || i === lot.length - 1) {
          fs.writeFileSync(DATA, JSON.stringify(serialise(), null, 2) + '\n');
          console.log(`  ${i + 1}/${lot.length} (enregistré)`);
        }
        await sleep(DETAIL_DELAY);
      }
    } finally {
      await browser2.close();
    }
    changes.push(`  i infos récupérées pour ${faits} jeu(x)${aCompleter.length > lot.length ? `, ${aCompleter.length - lot.length} restants` : ''}`);
  } else if (lot.length && DRY) {
    changes.push(`  i ${aCompleter.length} jeu(x) sans infos (non récupérées en --dry)`);
  }

  const out = serialise();

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
