(function () {
  const C = window.VSMP;
  const $ = (id) => document.getElementById(id);

  $("year").textContent = new Date().getFullYear();
  $("footer-ip").textContent = C.serverIp;
  $("discord-pill").href = C.discord;
  $("apply-btn").href = C.discord;
  $("discord-text").textContent = C.discord.replace(/^https?:\/\//, "");

  // Copy IP + petal burst
  $("copy-ip").addEventListener("click", function () {
    navigator.clipboard && navigator.clipboard.writeText(C.serverIp);
    $("copy-label").textContent = "COPIED TO SOUL";
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 70 + (i % 4) * 25;
      const p = document.createElement("span");
      p.className = "particle"; p.style.left = "50%"; p.style.top = "50%";
      this.style.position = "relative"; this.appendChild(p);
      p.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px,${Math.sin(a) * r + 30}px) rotate(${i * 47}deg) scale(.4)`, opacity: 0 }], { duration: 1200, easing: "ease-out" }).onfinish = () => p.remove();
    }
    setTimeout(() => ($("copy-label").textContent = "JOIN THE WAR"), 2200);
  });

  // Allies
  $("allies-grid").innerHTML = C.allies.map((a) => `<a class="ally" href="${a.url}" target="_blank" rel="noopener"><div class="card"><p class="tag">${a.tag}</p><h3>${a.name}</h3><p class="url">${a.url}</p></div></a>`).join("");

  // Admin bar: only admin emails get it
  UI.api("/api/me").then((m) => { $("admin-pill").hidden = !m.admin; }).catch(() => {});
  $("logout").addEventListener("click", async () => { try { await UI.api("/api/auth/logout", { body: {} }); } catch (e) {} location.href = "login.html"; });

  // One Discord identity for the whole site: sign-in button, or the connected avatar + name
  UI.api("/api/discord/status").then((s) => {
    const b = $("dc-nav");
    if (!s.configured && !s.linked) return;
    b.hidden = false;
    if (s.linked) {
      b.replaceChildren(s.avatar ? UI.h("img", { src: s.avatar, alt: "", class: "dc-av" }) : "", UI.h("span", {}, s.name));
      b.title = "Connected to Discord as " + s.username + ". Click to disconnect.";
      b.onclick = async () => { if (confirm("Disconnect your Discord account from this site?")) { await UI.api("/api/discord/unlink", { body: {} }); location.reload(); } };
    } else {
      b.textContent = "SIGN IN WITH DISCORD";
      b.onclick = async () => { try { location.href = (await UI.api("/api/discord/start")).url; } catch (e) { alert(e.message); } };
    }
  }).catch(() => {});

  // Announcement bar (set from the admin panel)
  UI.api("/api/announcement").then((a) => {
    if (!a.message) return;
    const bar = UI.h(a.link_url ? "a" : "div", { class: "announce", href: a.link_url || null, target: a.link_url ? "_blank" : null, rel: a.link_url ? "noopener" : null },
      a.tag ? UI.h("span", { class: "announce-tag" }, a.tag) : null,
      UI.h("span", { class: "announce-msg" }, a.message),
      a.link_url ? UI.h("span", { class: "announce-link" }, (a.link_label || "Open") + " ↗") : null);
    $("announce").replaceChildren(bar);
  }).catch(() => {});

  // numbers count up gently instead of hard-swapping
  const shown = {};
  function countTo(id, n) {
    const el = $(id);
    if (typeof n !== "number" || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = n; shown[id] = n; return; }
    const from = typeof shown[id] === "number" ? shown[id] : 0, t0 = performance.now();
    shown[id] = n;
    (function step(t) {
      const k = Math.min(1, (t - t0) / 600), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (n - from) * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  // Minecraft server status. Tries mcstatus.io first, then mcsrvstat.us.
  async function lookup() {
    try {
      const d = await (await fetch("https://api.mcstatus.io/v2/status/java/" + encodeURIComponent(C.serverIp))).json();
      if (d.online) return { online: true, now: d.players.online, max: d.players.max, version: d.version && d.version.name_clean };
    } catch (e) {}
    try {
      const d = await (await fetch("https://api.mcsrvstat.us/3/" + encodeURIComponent(C.serverIp))).json();
      if (d.online) return { online: true, now: d.players.online, max: d.players.max, version: d.version };
    } catch (e) {}
    return { online: false };
  }
  async function poll() {
    const s = await lookup();
    $("hero-dot").classList.toggle("on", s.online);
    $("badge-dot").classList.toggle("on", s.online);
    $("badge-text").textContent = s.online ? s.now + " ONLINE" : "OFFLINE";
    countTo("st-online", s.online ? s.now : 0);
    if (s.online) countTo("st-max", s.max); else $("st-max").textContent = "—";
    $("st-version").textContent = s.online && s.version ? s.version : "—";
  }
  poll();
  setInterval(poll, 30000);
})();
