// Animated pixel-sakura night background (ported from the reference design).
(function () {
  const canvas = document.getElementById("bg");
  const ctx = canvas.getContext("2d");
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const BLOOM = ["#FFFFFF", "#F5F5F5", "#E8E8E8", "#D8D8D8", "#EDEDED", "#CCCCCC", "#DDDDDD"];
  const BLOOM_HI = ["#FFFFFF", "#FAFAFA", "#F2F2F2"];

  function makeTree(x, groundY, b, alpha) {
    const blocks = [];
    const h = Math.round(rnd(9, 15));
    let off = 0;
    for (let i = 0; i < h; i++) {
      if (i > 3 && Math.random() < 0.22) off += Math.random() < 0.5 ? -1 : 1;
      blocks.push({ x: off, y: -i, c: "#2a2a2a" });
      if (i < h - 3) blocks.push({ x: off + 1, y: -i, c: "#1a1a1a" });
    }
    const top = -h;
    [[off, top - 1, 4.8], [off - 4, top + 2, 3.4], [off + 5, top + 1, 3.8], [off + 1, top - 4, 3.3], [off - 2, top - 3, 2.8], [off + 3, top - 2, 3]].forEach(([cx, cy, r]) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r * 1.4; dx <= r * 1.4; dx++) {
          const d = (dx * dx) / (r * r * 1.96) + (dy * dy) / (r * r);
          if (d <= 1 && Math.random() > d * 0.32)
            blocks.push({ x: Math.round(cx + dx), y: Math.round(cy + dy), c: pick(d > 0.7 && Math.random() < 0.35 ? BLOOM_HI : BLOOM) });
        }
    });
    return { x, groundY, b, blocks, alpha, phase: rnd(0, 6.28), h: h + 6 };
  }

  function drawTree(t, time, wind) {
    ctx.globalAlpha = t.alpha;
    for (const bl of t.blocks) {
      const k = Math.max(0, -bl.y) / t.h;
      const sway = (Math.sin(time * 0.7 + t.phase) * 2.2 + wind * 1.4) * k * k * t.b * 0.35;
      ctx.fillStyle = bl.c;
      ctx.fillRect(t.x + bl.x * t.b + sway, t.groundY + bl.y * t.b - t.b, t.b - 1, t.b - 1);
    }
    ctx.globalAlpha = 1;
  }

  let W, H, S, wind = 0, lastScroll = window.scrollY, mouse = { x: null, y: null }, lastRipple = 0;

  function build(w, h) {
    const near = Math.max(7, Math.min(13, w / 110));
    const far = near * 0.55;
    const ground = h * 0.97;
    const farTrees = [];
    for (let x = rnd(0, 80); x < w; x += rnd(110, 200)) farTrees.push(makeTree(x, ground - 10, far, 0.28));
    const nearTrees = [makeTree(w * 0.06, ground, near, 0.95), makeTree(w * 0.93, ground, near, 0.95)];
    if (w > 900) nearTrees.push(makeTree(w * 0.2, ground + 4, near * 0.8, 0.7), makeTree(w * 0.8, ground + 4, near * 0.8, 0.7));
    const hills = [];
    for (let x = 0; x < w + 24; x += 24) hills.push(h * 0.72 + Math.sin(x / 180) * 40 + Math.sin(x / 67) * 14);
    return {
      far: farTrees, near: nearTrees, hills, ground,
      stars: Array.from({ length: 110 }, () => ({ x: rnd(0, w), y: rnd(0, h * 0.6), s: rnd(0.8, 2.4), p: rnd(0, 6), sp: rnd(0.6, 1.8) })),
      petals: Array.from({ length: Math.min(160, Math.round(w / 9)) }, () => {
        const d = rnd(0.3, 1);
        return { x: rnd(0, w), y: rnd(0, h), s: rnd(2.5, 6) * (0.5 + d * 0.8), vy: rnd(0.25, 0.7) * (0.5 + d), vx: rnd(-0.25, 0.55), rot: rnd(0, 6), vr: rnd(-0.035, 0.035), c: pick(BLOOM), a: rnd(0.35, 0.85) * (0.5 + d * 0.5), phase: rnd(0, 6), depth: d, flutter: rnd(0.5, 1.4) };
      }),
      fireflies: Array.from({ length: Math.min(34, Math.round(w / 45)) }, () => ({ x: rnd(0, w), y: rnd(h * 0.3, h * 0.92), r: rnd(1, 2.4), p: rnd(0, 6), sp: rnd(0.4, 1.1), vx: rnd(-0.18, 0.18), vy: rnd(-0.12, 0.12), c: Math.random() < 0.5 ? "#FFFFFF" : "#E0E0E0" })),
      mist: Array.from({ length: 3 }, (_, i) => ({ y: h * (0.66 + i * 0.1), off: rnd(0, 6), sp: rnd(0.04, 0.12), a: 0.05 + i * 0.02, h: h * (0.16 + i * 0.04) })),
      ripples: []
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = build(W, H);
  }

  function frame(t) {
    const time = t / 1000;
    const dy = window.scrollY - lastScroll; lastScroll = window.scrollY;
    wind += (Math.max(-40, Math.min(40, dy)) * 0.12 - wind) * 0.06;
    const w = wind + (Math.sin(time * 0.13) * 0.55 + Math.sin(time * 0.31) * 0.28 + Math.sin(time * 0.07) * 0.4);

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#080808"); g.addColorStop(0.45, "#0C0C0C"); g.addColorStop(1, "#161616");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    S.stars.forEach((s) => { ctx.globalAlpha = 0.25 + (Math.sin(time * s.sp + s.p) * 0.5 + 0.5) * 0.55; ctx.fillStyle = "#E0E6ED"; ctx.fillRect(s.x, s.y, s.s, s.s); });
    ctx.globalAlpha = 1;

    // moon
    const mx = W * 0.78, my = H * 0.22, md = Math.min(W, H) * 0.1, pulse = 1 + Math.sin(time * 0.7) * 0.05, glow = md * (3.4 + Math.sin(time * 0.5) * 0.3);
    let rg = ctx.createRadialGradient(mx, my, md * 0.4, mx, my, glow);
    rg.addColorStop(0, "rgba(255,255,255,0.24)"); rg.addColorStop(0.5, "rgba(255,255,255,0.09)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg; ctx.fillRect(mx - glow, my - glow, glow * 2, glow * 2);
    ctx.save(); ctx.translate(mx, my); ctx.rotate(time * 0.06); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = md * (2.2 + Math.sin(time * 0.9 + i) * 0.3);
      const lg = ctx.createLinearGradient(0, 0, Math.cos(a) * r, Math.sin(a) * r);
      lg.addColorStop(0, "rgba(255,255,255,0.18)"); lg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = lg; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1; ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.beginPath(); ctx.arc(mx, my, md * pulse, 0, Math.PI * 2); ctx.fill();
    rg = ctx.createRadialGradient(mx - md * 0.3, my - md * 0.3, 0, mx, my, md * pulse);
    rg.addColorStop(0, "rgba(255,255,255,0.9)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(mx, my, md * pulse, 0, Math.PI * 2); ctx.fill();

    // hills + mist + trees
    ctx.fillStyle = "#0E0E0E"; S.hills.forEach((y, i) => ctx.fillRect(i * 24, y, 24, H - y));
    S.mist.forEach((m) => {
      const dx = Math.sin(time * m.sp + m.off) * 40;
      const mg = ctx.createLinearGradient(0, m.y - m.h / 2, 0, m.y + m.h / 2);
      mg.addColorStop(0, "rgba(200,200,200,0)"); mg.addColorStop(0.5, `rgba(200,200,200,${m.a})`); mg.addColorStop(1, "rgba(200,200,200,0)");
      ctx.fillStyle = mg; ctx.fillRect(dx - 60, m.y - m.h / 2, W + 120, m.h);
    });
    S.far.forEach((tr) => drawTree(tr, time, w));
    ctx.fillStyle = "#080808"; ctx.fillRect(0, S.ground, W, H - S.ground);
    S.near.forEach((tr) => drawTree(tr, time, w));

    // fireflies
    S.fireflies.forEach((f) => {
      f.x += f.vx + Math.sin(time * 0.4 + f.p) * 0.15; f.y += f.vy + Math.cos(time * 0.3 + f.p) * 0.1;
      if (f.x > W + 6) f.x = -6; if (f.x < -6) f.x = W + 6; if (f.y > H * 0.95) f.y = H * 0.3; if (f.y < H * 0.28) f.y = H * 0.92;
      const a = Math.sin(time * f.sp + f.p) * 0.5 + 0.5;
      const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 6);
      fg.addColorStop(0, f.c); fg.addColorStop(0.3, "rgba(255,255,255,0.25)"); fg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 0.3 + a * 0.5; ctx.fillStyle = fg; ctx.fillRect(f.x - f.r * 6, f.y - f.r * 6, f.r * 12, f.r * 12);
      ctx.globalAlpha = 0.6 + a * 0.4; ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + a * 0.5), 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // petals
    S.petals.forEach((p) => {
      p.y += p.vy + Math.abs(w) * 0.22 * p.depth;
      p.x += p.vx + w * p.s * 0.22 + Math.sin(time * p.flutter + p.phase) * 0.4;
      p.rot += p.vr + w * 0.01;
      if (p.y > H + 10) { p.y = -10; p.x = rnd(0, W); }
      if (p.y < -12) p.y = H + 8;
      if (p.x > W + 10) p.x = -10; if (p.x < -10) p.x = W + 10;
      ctx.save(); ctx.globalAlpha = p.a; ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); ctx.restore();
    });
    ctx.globalAlpha = 1;

    // cursor glow + ripples
    if (mouse.x != null) {
      const cg = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 120);
      cg.addColorStop(0, "rgba(255,255,255,0.14)"); cg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cg; ctx.fillRect(mouse.x - 120, mouse.y - 120, 240, 240);
    }
    S.ripples = S.ripples.filter((r) => r.age < 1);
    S.ripples.forEach((r) => {
      r.age += 0.012;
      const rad = r.age * 180, amp = (1 - r.age) * 6, al = (1 - r.age) * 0.5;
      ctx.save(); ctx.translate(r.x, r.y); ctx.strokeStyle = `rgba(255,255,255,${al})`; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.12) {
        const rr = rad + Math.sin(a * 6 + r.age * 14) * amp;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke(); ctx.restore();
    });
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    const now = performance.now();
    if (now - lastRipple > 90) { lastRipple = now; S.ripples.push({ x: e.clientX, y: e.clientY, age: 0 }); if (S.ripples.length > 8) S.ripples.shift(); }
  });
  resize();
  requestAnimationFrame(frame);
})();
