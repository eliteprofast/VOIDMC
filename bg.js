// Background: deep navy with a faint grid, soft blue and purple glows, and a few slow floating pixel squares.
(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = () => window.innerWidth < 700;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const COLORS = ["#4DB5FF", "#2F6FED", "#A64CFF", "#4ADE80", "#F5B83D"];
  let W, H, squares = [], grid = null, running = false;

  function build() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the grid is drawn once and reused every frame
    grid = document.createElement("canvas");
    grid.width = W; grid.height = H;
    const g = grid.getContext("2d");
    g.strokeStyle = "rgba(80,120,255,0.07)"; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= W; x += 48) { g.moveTo(x + .5, 0); g.lineTo(x + .5, H); }
    for (let y = 0; y <= H; y += 48) { g.moveTo(0, y + .5); g.lineTo(W, y + .5); }
    g.stroke();
    const n = small() ? 12 : 30;
    squares = Array.from({ length: n }, () => ({ x: Math.round(rnd(0, W) / 8) * 8, y: rnd(0, H), s: pick([6, 8, 10, 12, 16]), vy: rnd(0.1, 0.35), a: rnd(0.1, 0.28), c: pick(COLORS), ph: rnd(0, 6) }));
  }

  function draw(time) {
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, "#050A1E"); base.addColorStop(0.6, "#060D2E"); base.addColorStop(1, "#0B0933");
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    // soft glows
    const g1 = ctx.createRadialGradient(W * 0.12, H * 0.1, 0, W * 0.12, H * 0.1, Math.max(W, H) * 0.55);
    g1.addColorStop(0, "rgba(47,111,237,0.16)"); g1.addColorStop(1, "rgba(47,111,237,0)");
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W * 0.9, H * 0.95, 0, W * 0.9, H * 0.95, Math.max(W, H) * 0.6);
    g2.addColorStop(0, "rgba(140,50,230,0.2)"); g2.addColorStop(1, "rgba(140,50,230,0)");
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(grid, 0, 0);
    // floating pixel squares
    for (const q of squares) {
      if (!reduced) { q.y -= q.vy; if (q.y < -20) { q.y = H + 20; q.x = Math.round(rnd(0, W) / 8) * 8; } }
      ctx.globalAlpha = q.a * (0.65 + 0.35 * Math.sin(time * 0.8 + q.ph));
      ctx.fillStyle = q.c;
      ctx.fillRect(q.x + (reduced ? 0 : Math.sin(time * 0.3 + q.ph) * 6), q.y, q.s, q.s);
    }
    ctx.globalAlpha = 1;
  }

  function frame(t) {
    if (document.hidden) { running = false; return; } // costs nothing while the tab is hidden
    draw(t / 1000);
    if (reduced) { running = false; return; } // reduced motion: one still frame
    requestAnimationFrame(frame);
  }
  function start() { if (!running) { running = true; requestAnimationFrame(frame); } }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
  window.addEventListener("resize", () => { build(); if (reduced) { running = false; start(); } });
  build();
  start();
})();
