(function () {
  const { h, api } = UI;
  const C = window.VSMP;
  const SYM = { EUR: "€", USD: "$" };
  const money = (n, cur) => (SYM[cur] || "$") + Number(n).toFixed(2);

  // everything that can go in the cart (a money price). Coin Shop items cost Coins and are listed but not added to the cart.
  const sections = C.storeSections || [];
  const catalogue = [].concat(C.ranks || [], ...sections.map((s) => s.items || []), C.items || []).filter((p) => p && p.id && typeof p.price === "number");
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem("vsmp_cart") || "[]").filter((l) => catalogue.some((p) => p.id === l.id)); } catch (e) {}

  const drawer = document.getElementById("cart");
  const list = document.getElementById("cart-list");
  const totalEl = document.getElementById("cart-total");
  const countEl = document.getElementById("cart-count");
  const msg = document.getElementById("cart-msg");
  const form = document.getElementById("cart-form");

  function persist() { try { localStorage.setItem("vsmp_cart", JSON.stringify(cart)); } catch (e) {} }
  function add(p) {
    const l = cart.find((x) => x.id === p.id);
    l ? l.qty++ : cart.push({ id: p.id, qty: 1 });
    persist(); draw(); drawer.classList.add("open");
  }
  function setQty(id, q) {
    cart = q <= 0 ? cart.filter((x) => x.id !== id) : cart.map((x) => (x.id === id ? { id, qty: Math.min(10, q) } : x));
    persist(); draw();
  }
  // one total per currency, so euros and dollars are never mixed up
  function totalsOf(lines) {
    const t = {};
    lines.forEach((l) => { const c = SYM[l.p.currency] ? l.p.currency : "USD"; t[c] = Math.round(((t[c] || 0) + l.p.price * l.qty) * 100) / 100; });
    return t;
  }
  const totalText = (t) => Object.keys(SYM).filter((c) => t[c]).map((c) => money(t[c], c)).join(" + ") || money(0, "USD");

  function draw() {
    const lines = cart.map((l) => ({ p: catalogue.find((p) => p.id === l.id), qty: l.qty })).filter((l) => l.p);
    countEl.textContent = lines.reduce((s, l) => s + l.qty, 0);
    countEl.hidden = false; // the cart box always shows its number, even 0
    totalEl.textContent = totalText(totalsOf(lines));
    form.hidden = !lines.length;
    list.replaceChildren(...(lines.length ? lines.map(({ p, qty }) => h("div", { class: "cart-line" },
      h("div", {}, h("strong", {}, p.name), h("p", { class: "mono small muted" }, money(p.price, p.currency) + " each")),
      h("div", { class: "qty" },
        h("button", { type: "button", onclick: () => setQty(p.id, qty - 1), "aria-label": "Less" }, "−"),
        h("span", {}, qty),
        h("button", { type: "button", onclick: () => setQty(p.id, qty + 1), "aria-label": "More" }, "+"))))
      : [h("p", { class: "muted", style: "padding:24px 0" }, "Your cart is empty.")]));
  }

  // rank cards
  document.getElementById("ranks-grid").replaceChildren(...(C.ranks || []).map((r) => h("div", { class: "card rank" + (r.featured ? " featured" : "") },
    h("div", { class: "rank-top" }, h("span", { class: "rank-ico", style: "background:" + r.color }, "♛"), h("h3", {}, r.name), r.featured ? h("span", { class: "tag-top" }, "Top") : null),
    h("p", { class: "price" }, money(r.price, r.currency)),
    h("ul", {}, r.perks.map((x) => h("li", {}, x))),
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); add(r); } }, "Add to cart"))));

  // the other sections: Coins, Crate Keys, Coin Shop, Time Kits
  document.getElementById("store-sections").replaceChildren(...sections.map((s) => h("div", { class: "store-sec" },
    h("div", { class: "store-sec-head" }, h("h3", {}, s.title), s.note ? h("p", { class: "mono small muted" }, s.note) : null),
    h("div", { class: "grid three" }, (s.items || []).map((p) => h("div", { class: "card" },
      p.badge ? h("span", { class: "tag-top" }, p.badge) : null,
      h("h4", { class: "item-name" }, p.name),
      p.desc ? h("p", {}, p.desc) : null,
      typeof p.price === "number"
        ? h("div", { class: "item-foot" }, h("span", { class: "mono white" }, money(p.price, p.currency)), h("button", { type: "button", class: "mini", "aria-label": "Add " + p.name + " to cart", onclick: () => add(p) }, "ADD"))
        : h("div", { class: "item-foot" }, h("span", { class: "mono white" }, Number(p.coins).toLocaleString() + " Coins"), h("span", { class: "mono small muted" }, "pay with Coins"))))))));

  document.getElementById("cart-open").addEventListener("click", () => drawer.classList.add("open"));
  document.getElementById("cart-close").addEventListener("click", () => drawer.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    msg.textContent = "Placing your order…";
    try {
      const d = await api("/api/order", { body: { username: f.get("username"), email: f.get("email"), items: cart } });
      cart = []; persist(); draw();
      msg.textContent = "Order #" + d.id + " received (" + d.totalText + "). Open a ticket in #support on Discord with this number to pay and claim it.";
      const cur = Object.keys(d.totals || {});
      if (C.paypalMe && cur.length === 1) msg.append(" ", h("a", { href: C.paypalMe + "/" + d.totals[cur[0]] + cur[0], target: "_blank", rel: "noopener", class: "white" }, "Pay with PayPal ↗")); // only when the order is in one currency
    } catch (err) { msg.textContent = err.message; }
  });
  draw();
})();
