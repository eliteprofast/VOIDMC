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

  // load the gallery only when it is about to scroll into view
  const loadGallery = () => api("/api/gallery").then((d) => { items = d; render(); }).catch((e) => { grid.replaceChildren(h("p", { class: "empty mono" }, e.message)); });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { io.disconnect(); loadGallery(); } }, { rootMargin: "500px 0px" });
    io.observe(grid);
  } else loadGallery();

  // submit form
  const form = document.getElementById("gallery-form");
  document.getElementById("gallery-toggle").addEventListener("click", () => form.classList.toggle("open"));
  let LIMIT = 550 * 1024; // updated from the server below: Supabase allows bigger pictures than Upstash
  api("/api/upload-info").then((d) => { LIMIT = Math.min(Math.floor(d.max * 0.9), 4 * 1024 * 1024); }).catch(() => {});
  async function shrink(f) {
    if (f.size <= LIMIT) return f;
    if (f.type === "image/gif") throw new Error("That GIF is too big. Please pick one under 0.5 MB, or a normal picture.");
    let bmp;
    try { bmp = await createImageBitmap(f); } catch (e) { throw new Error("Couldn't read that image. Try another one."); }
    let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    for (let round = 0; round < 6; round++) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.75, 0.65, 0.55]) {
        const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
        if (blob && blob.size <= LIMIT) return blob;
      }
      scale *= 0.75;
    }
    throw new Error("Couldn't shrink that image enough. Try a smaller one.");
  }
  const file = document.getElementById("gallery-file"), fileName = document.getElementById("gallery-file-name"), preview = document.getElementById("gallery-preview");
  const HINT = fileName.textContent;
  file.addEventListener("change", () => {
    const f = file.files[0];
    if (preview.src) URL.revokeObjectURL(preview.src);
    if (!f) { fileName.textContent = HINT; preview.hidden = true; preview.removeAttribute("src"); return; }
    if (f.size > 25 * 1024 * 1024) { msg.textContent = "That image is too big. The limit is 25 MB."; file.value = ""; fileName.textContent = HINT; preview.hidden = true; return; }
    fileName.textContent = f.name;
    preview.src = URL.createObjectURL(f); preview.hidden = false; msg.textContent = "";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const pick = file.files[0];
    const video = String(f.get("video") || "").trim();
    if (!pick && !video) { msg.textContent = "Please upload an image or paste a video link."; return; }
    msg.textContent = pick ? "Uploading…" : "Sending…";
    try {
      let image = "";
      if (pick) {
        let r;
        const toSend = await shrink(pick);
        try { r = await fetch("api/upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: toSend, credentials: "same-origin" }); }
        catch (x) { throw new Error("Couldn't upload the image. Please try again."); }
        let d = {}; try { d = await r.json(); } catch (x) {}
        if (!r.ok) throw new Error(d.error || "Couldn't upload the image. Please try again.");
        image = d.path;
      }
      await api("/api/gallery", { body: { title: f.get("title"), player: f.get("player"), image, video, caption: f.get("caption") } });
      form.reset(); form.classList.remove("open"); fileName.textContent = HINT; preview.hidden = true; preview.removeAttribute("src");
      msg.textContent = "Thanks! Staff will review your moment before it appears.";
    } catch (err) { msg.textContent = err.message; }
  });
})();
