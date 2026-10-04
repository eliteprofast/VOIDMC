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

  // Ranks
  $("ranks-grid").innerHTML = C.ranks.map((r) => `
    <div class="card rank ${r.featured ? "featured" : ""}">
      <div class="rank-top"><span class="rank-ico" style="background:${r.color}">♛</span><h3>${r.name}</h3>${r.featured ? '<span class="tag-top">Top</span>' : ""}</div>
      <p class="price">$${r.price.toFixed(2)}</p>
      <ul>${r.perks.map((p) => `<li>${p}</li>`).join("")}</ul>
      <a href="${C.discord}" target="_blank" rel="noopener">Buy via ticket</a>
    </div>`).join("");

  // Gallery
  $("gallery-grid").innerHTML = C.gallery.length
    ? C.gallery.map((g) => `<div class="card shot"><img src="${g.image}" alt="${g.title}"><div><h3>${g.title}</h3><p class="mono">${g.player || ""}</p></div></div>`).join("")
    : '<p class="empty mono">No moments shared yet — be the first to post one.</p>';

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
    $("st-online").textContent = s.online ? s.now : "0";
    $("st-max").textContent = s.online ? s.max : "—";
    $("st-version").textContent = s.online && s.version ? s.version : "—";
  }
  poll();
  setInterval(poll, 30000);
})();
