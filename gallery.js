(function () {
  const { h, api, clientId } = UI;
  const grid = document.getElementById("gallery-grid");
  const msg = document.getElementById("gallery-msg");
  const voted = new Set(JSON.parse(localStorage.getItem("vsmp_voted") || "[]"));
  let items = [];

  function thumb(g) {
    return h("img", { src: g.thumb, alt: g.title, loading: "lazy", referrerpolicy: "no-referrer" });
  }

  async function vote(g, btn, countEl) {
    try {
      const d = await api("/api/gallery/vote", { body: { id: g.id, client: clientId() } });
      g.votes = d.votes;
      countEl.textContent = d.votes;
      btn.classList.toggle("on", d.voted);
      d.voted ? voted.add(g.id) : voted.delete(g.id);
      try { localStorage.setItem("vsmp_voted", JSON.stringify([...voted])); } catch (e) {}
    } catch (e) { msg.textContent = e.message; }
  }

  function voteBtn(g) {
    const count = h("span", {}, g.votes);
    const b = h("button", { class: "vote" + (voted.has(g.id) ? " on" : ""), type: "button", "aria-label": "Give a thumbs up" }, "👍 ", count);
    b.addEventListener("click", (e) => { e.stopPropagation(); vote(g, b, count); });
    return b;
  }

  function open(g) {
    const media = g.kind === "youtube"
      ? h("iframe", { src: "https://www.youtube-nocookie.com/embed/" + g.url, allow: "autoplay; encrypted-media; picture-in-picture", allowfullscreen: true, title: g.title })
      : h("img", { src: g.url, alt: g.title, referrerpolicy: "no-referrer" });
    const box = h("div", { class: "lightbox", onclick: (e) => { if (e.target === box) box.remove(); } },
      h("div", { class: "lightbox-in" },
        h("button", { class: "lightbox-x", type: "button", "aria-label": "Close", onclick: () => box.remove() }, "✕"),
        h("div", { class: "lightbox-media" }, media),
        h("div", { class: "lightbox-info" }, h("h3", {}, g.title), h("p", { class: "mono small" }, g.player), g.caption ? h("p", {}, g.caption) : null, voteBtn(g))));
    document.body.append(box);
  }

  function render() {
    if (!items.length) { grid.replaceChildren(h("p", { class: "empty mono" }, "No moments shared yet — be the first to post one.")); return; }
    grid.replaceChildren(...items.map((g) => h("div", { class: "card shot", tabindex: "0", onclick: () => open(g) },
      h("div", { class: "shot-img" }, thumb(g), g.kind === "youtube" ? h("span", { class: "play" }, "▶") : null),
      h("div", { class: "shot-meta" }, h("div", {}, h("h3", {}, g.title), h("p", { class: "mono small" }, g.player)), voteBtn(g)))));
  }

  api("/api/gallery").then((d) => { items = d; render(); }).catch((e) => { grid.replaceChildren(h("p", { class: "empty mono" }, e.message)); });

  // submit form
  const form = document.getElementById("gallery-form");
  document.getElementById("gallery-toggle").addEventListener("click", () => form.classList.toggle("open"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    msg.textContent = "Sending…";
    try {
      await api("/api/gallery", { body: { title: f.get("title"), player: f.get("player"), url: f.get("url"), caption: f.get("caption") } });
      form.reset(); form.classList.remove("open");
      msg.textContent = "Thanks! Staff will review your moment before it appears.";
    } catch (err) { msg.textContent = err.message; }
  });
})();
