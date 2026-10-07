// Leaderboard page: ranked table, a profile panel with a history chart, totals and top clans. Built with DOM nodes only.
(function () {
  const { h, api } = UI;
  const C = window.VSMP || {};
  const $ = (id) => document.getElementById(id);
  const CUR = C.currency || "$";
  const st = { sort: "balance", q: "", limit: 20, data: null, sel: "", metric: "balance", detail: null, timer: null };

  const compact = (n, sym) => { n = Number(n) || 0; const a = Math.abs(n); const f = (v, s) => (sym || "") + (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$|(\.\d)0$/, "$1") + s; return a >= 1e12 ? f(n / 1e12, "T") : a >= 1e9 ? f(n / 1e9, "B") : a >= 1e6 ? f(n / 1e6, "M") : a >= 1e3 ? f(n / 1e3, "K") : (sym || "") + Math.round(n); };
  const int = (n) => Number(n || 0).toLocaleString();
  const pct = (v) => (v == null ? "–" : (v > 0 ? "+" : "") + v.toFixed(2) + "%");
  const ago = (t) => { if (!t) return "never"; const s = Math.round((Date.now() - t) / 1000); return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };
  // if a head image cannot load, show a plain blue block instead of a broken-image icon
  const FALLBACK = "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\" fill=\"#16224F\"/><rect x=\"2\" y=\"2\" width=\"4\" height=\"4\" fill=\"#4DB5FF\"/></svg>");
  const broken = (e) => { e.target.onerror = null; e.target.src = FALLBACK; };
  const avatar = (name, size) => "https://mc-heads.net/avatar/" + encodeURIComponent(name) + "/" + (size || 40);

  // ----- table -----
  function row(p) {
    const up = p.change24 > 0, down = p.change24 < 0;
    return h("button", { type: "button", class: "lb-row lb-data" + (p.name === st.sel ? " sel" : "") + (p.rank <= 3 ? " top" + p.rank : ""), onclick: () => select(p.name) },
      h("span", { class: "rk" }, String(p.rank)),
      h("span", { class: "pl" }, h("img", { class: "av", src: avatar(p.name), alt: "", loading: "lazy", referrerpolicy: "no-referrer", width: 32, height: 32, onerror: broken }), h("span", { class: "nm" }, h("b", {}, p.name), h("small", {}, p.clan || "no clan"))),
      h("span", { class: "r bal" }, compact(p.balance, CUR)),
      h("span", { class: "r hide-sm " + (up ? "up" : down ? "down" : "") }, pct(p.change24)),
      h("span", { class: "r" }, p.kd.toFixed(2)),
      h("span", { class: "r hide-sm" }, int(p.kills)));
  }
  function drawTable() {
    const d = st.data; if (!d) return;
    $("lb-rows").replaceChildren(...(d.players.length ? d.players.map(row) : [h("p", { class: "empty mono" }, d.count ? "No player matches that search." : "No players on the leaderboard yet. Staff can add them in Admin → Leaderboard, or connect the server.")]));
    $("lb-more").hidden = !(d.matches > st.limit);
    $("lb-count").textContent = int(d.count);
    $("lb-updated").textContent = ago(d.updatedAt);
    const T = d.totals;
    $("lb-pulse").replaceChildren(
      ...[["Total balance", compact(T.balance, CUR)], ["Total kills", compact(T.kills)], ["Total deaths", compact(T.deaths)], ["Average K/D", Number(T.avgKd).toFixed(2)], ["Hours played", int(T.playtime)]]
        .map(([a, b]) => h("div", { class: "pulse" }, h("span", {}, a), h("b", {}, b))));
    $("lb-clans").replaceChildren(...(d.clans.length ? d.clans.map((c, i) => h("div", { class: "clan" }, h("span", { class: "ci" }, String(i + 1)), h("b", {}, c.clan), h("small", {}, c.members + (c.members === 1 ? " member" : " members")), h("em", {}, int(c.kills) + " kills"))) : [h("p", { class: "muted small" }, "Clans appear once players have one.")]));
  }
  async function load(keepSel) {
    try {
      const d = await api("/api/leaderboard?sort=" + st.sort + "&limit=" + st.limit + "&q=" + encodeURIComponent(st.q));
      st.data = d; drawTable();
      if (!keepSel || !st.sel) { if (d.players[0]) select(d.players[0].name); else { st.sel = ""; st.detail = null; drawProfile(); } }
    } catch (e) { $("lb-rows").replaceChildren(h("p", { class: "empty mono" }, e.message)); }
  }

  // ----- profile + chart -----
  async function select(name) {
    st.sel = name; drawTable();
    try { st.detail = await api("/api/leaderboard/player?name=" + encodeURIComponent(name)); } catch (e) { st.detail = null; }
    drawProfile();
  }
  function drawProfile() {
    const p = st.detail;
    $("lb-name").textContent = p ? p.name : "No player selected";
    $("lb-clan").textContent = p ? (p.clan || "no clan") : "";
    $("lb-rank").textContent = p ? "#" + p.rank : "";
    $("lb-av").style.visibility = p ? "visible" : "hidden"; $("lb-av").onerror = broken; if (p) $("lb-av").src = avatar(p.name, 64);
    $("lb-bal").textContent = p ? compact(p.balance, CUR) : "–";
    const chg = $("lb-chg"); chg.textContent = p && p.change24 != null ? pct(p.change24) : ""; chg.className = p && p.change24 > 0 ? "up" : p && p.change24 < 0 ? "down" : "";
    $("lb-k").textContent = p ? int(p.kills) : "–"; $("lb-d").textContent = p ? int(p.deaths) : "–"; $("lb-kd").textContent = p ? p.kd.toFixed(2) : "–"; $("lb-pt").textContent = p ? int(p.playtime) + "h" : "–";
    drawChart();
  }
  function drawChart() {
    const cv = $("lb-chart"), msg = $("lb-chart-msg"), p = st.detail;
    const ctx = cv.getContext && cv.getContext("2d");
    const pts = p ? p.history.map((s) => ({ t: s[0], v: st.metric === "kills" ? s[2] : s[1] })) : [];
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth || 360, H = 200;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    msg.textContent = pts.length < 2 ? "The chart fills in as the leaderboard updates (one point per hour)." : "";
    if (pts.length < 2) return;
    const lo = Math.min(...pts.map((x) => x.v)), hi = Math.max(...pts.map((x) => x.v)), span = hi - lo || Math.max(1, hi * 0.02);
    const pad = { l: 8, r: 64, t: 10, b: 20 }, gw = W - pad.l - pad.r, gh = H - pad.t - pad.b;
    const X = (i) => pad.l + (i / (pts.length - 1)) * gw, Y = (v) => pad.t + (1 - (v - lo) / span) * gh;
    ctx.font = "11px JetBrains Mono, monospace"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(80,120,255,.18)"; ctx.fillStyle = "#A9B6E0"; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = pad.t + (i / 3) * gh; ctx.beginPath(); ctx.moveTo(pad.l, y + .5); ctx.lineTo(W - pad.r, y + .5); ctx.stroke(); ctx.fillText(compact(hi - (i / 3) * span, st.metric === "kills" ? "" : CUR), W - pad.r + 8, y); }
    const g = ctx.createLinearGradient(0, pad.t, 0, H - pad.b); g.addColorStop(0, "rgba(77,181,255,.35)"); g.addColorStop(1, "rgba(77,181,255,0)");
    ctx.beginPath(); pts.forEach((x, i) => (i ? ctx.lineTo(X(i), Y(x.v)) : ctx.moveTo(X(i), Y(x.v)))); ctx.lineTo(X(pts.length - 1), H - pad.b); ctx.lineTo(X(0), H - pad.b); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach((x, i) => (i ? ctx.lineTo(X(i), Y(x.v)) : ctx.moveTo(X(i), Y(x.v)))); ctx.strokeStyle = "#4DB5FF"; ctx.lineWidth = 2; ctx.stroke();
    const last = pts[pts.length - 1]; ctx.fillStyle = "#4DB5FF"; ctx.fillRect(X(pts.length - 1) - 3, Y(last.v) - 3, 6, 6);
    ctx.fillStyle = "#A9B6E0"; ctx.textBaseline = "alphabetic"; ctx.fillText(new Date(pts[0].t).toLocaleDateString([], { month: "short", day: "numeric" }), pad.l, H - 4);
    ctx.textAlign = "right"; ctx.fillText(new Date(last.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), W - pad.r, H - 4); ctx.textAlign = "left";
  }

  // ----- controls -----
  $("lb-tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-sort]"); if (!b) return; st.sort = b.dataset.sort; st.limit = 20; [...$("lb-tabs").children].forEach((x) => x.classList.toggle("on", x === b)); load(true); });
  $("lb-metric").addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (!b) return; st.metric = b.dataset.m; [...$("lb-metric").children].forEach((x) => x.classList.toggle("on", x === b)); drawChart(); });
  let t = null; $("lb-search").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.limit = 20; load(true); }, 250); });
  $("lb-more").addEventListener("click", () => { st.limit = Math.min(200, st.limit + 20); load(true); });
  let rz = null; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(drawChart, 150); });
  if ($("nav-discord")) $("nav-discord").href = C.discord || "#";

  // who is online right now
  api("/api/mc-status").then((m) => { $("lb-online").textContent = m.online ? m.now : "0"; $("lb-dot").classList.toggle("on", !!m.online); }).catch(() => { $("lb-online").textContent = "–"; });

  load(false);
  setInterval(() => { if (document.visibilityState === "visible") { load(true); if (st.sel) api("/api/leaderboard/player?name=" + encodeURIComponent(st.sel)).then((d) => { st.detail = d; drawProfile(); }).catch(() => {}); } }, 60000);
})();
