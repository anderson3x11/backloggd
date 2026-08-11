/* Animated ASCII background — flowing sine field rendered as a monospace char ramp. */
(function () {
  const canvas = document.getElementById('ascii-bg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  const RAMP = ' .:-=+*#%@';
  const CELL_W = 13;
  const CELL_H = 19;
  const FPS = 12;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // One fillStyle per bucket instead of per glyph — keeps the draw loop cheap.
  const BUCKETS = [
    'rgba(115, 115, 115, 0.13)',
    'rgba(145, 145, 145, 0.18)',
    'rgba(190, 190, 190, 0.22)',
    'rgba(245, 245, 245, 0.26)',
  ];

  let cols = 0, rows = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '13px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    cols = Math.ceil(w / CELL_W);
    rows = Math.ceil(h / CELL_H);
  }

  // Four interfering waves, normalised to 0..1. No radial term — that clumps the
  // field into one big blob instead of an even drifting texture.
  function field(x, y, t) {
    const s =
      Math.sin(x * 0.27 + t * 1.1) +
      Math.sin(y * 0.33 - t * 0.9) +
      Math.sin((x + y) * 0.19 + t * 0.6) +
      Math.sin((x - y) * 0.15 - t * 0.45);
    return (s + 4) / 8;
  }

  const FLOOR = 0.58;

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Collect glyphs per bucket, then flush each bucket in one fillStyle pass.
    const batches = BUCKETS.map(() => []);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = field(x, y, t);
        if (v < FLOOR) continue;
        const n = (v - FLOOR) / (1 - FLOOR);
        const ci = Math.min(RAMP.length - 1, 1 + Math.floor(n * (RAMP.length - 1)));
        const b = v > 0.92 ? 3 : v > 0.82 ? 2 : v > 0.68 ? 1 : 0;
        batches[b].push(RAMP[ci], x * CELL_W, y * CELL_H);
      }
    }

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      if (!batch.length) continue;
      ctx.fillStyle = BUCKETS[b];
      for (let i = 0; i < batch.length; i += 3) {
        ctx.fillText(batch[i], batch[i + 1], batch[i + 2]);
      }
    }
  }

  resize();
  window.addEventListener('resize', resize);

  if (reduced) {
    draw(0);
    return;
  }

  let last = 0;
  const interval = 1000 / FPS;
  (function loop(now) {
    requestAnimationFrame(loop);
    if (now - last < interval) return;
    last = now;
    draw(now / 3200);
  })(0);
})();
