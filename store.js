(function () {
  const { h, api } = UI;
  const C = window.VSMP;
  const catalogue = [].concat(C.ranks || [], C.items || []);
  const money = (n) => "$" + Number(n).toFixed(2);
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

  function draw() {
    const lines = cart.map((l) => ({ p: catalogue.find((p) => p.id === l.id), qty: l.qty })).filter((l) => l.p);
    const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
    countEl.textContent = lines.reduce((s, l) => s + l.qty, 0);
    countEl.hidden = !lines.length;
    totalEl.textContent = money(total);
    form.hidden = !lines.length;
    list.replaceChildren(...(lines.length ? lines.map(({ p, qty }) => h("div", { class: "cart-line" },
      h("div", {}, h("strong", {}, p.name), h("p", { class: "mono small muted" }, money(p.price) + " each")),
      h("div", { class: "qty" },
        h("button", { type: "button", onclick: () => setQty(p.id, qty - 1), "aria-label": "Less" }, "−"),
        h("span", {}, qty),
        h("button", { type: "button", onclick: () => setQty(p.id, qty + 1), "aria-label": "More" }, "+"))))
      : [h("p", { class: "muted", style: "padding:24px 0" }, "Your cart is empty.")]));
  }

  // rank cards + compact item cards
  document.getElementById("ranks-grid").replaceChildren(...(C.ranks || []).map((r) => h("div", { class: "card rank" + (r.featured ? " featured" : "") },
    h("div", { class: "rank-top" }, h("span", { class: "rank-ico", style: "background:" + r.color }, "♛"), h("h3", {}, r.name), r.featured ? h("span", { class: "tag-top" }, "Top") : null),
    h("p", { class: "price" }, money(r.price)),
    h("ul", {}, r.perks.map((x) => h("li", {}, x))),
    h("a", { href: "#", onclick: (e) => { e.preventDefault(); add(r); } }, "Add to cart"))));
  const itemsEl = document.getElementById("items-grid");
  if ((C.items || []).length) itemsEl.replaceChildren(...C.items.map((p) => h("div", { class: "card" },
    p.badge ? h("span", { class: "tag-top" }, p.badge) : null, h("h3", {}, p.name), h("p", {}, p.desc || ""),
    h("div", { class: "item-foot" }, h("span", { class: "mono white" }, money(p.price)), h("button", { type: "button", class: "mini", onclick: () => add(p) }, "ADD")))));
  else itemsEl.remove();

  document.getElementById("cart-open").addEventListener("click", () => drawer.classList.add("open"));
  document.getElementById("cart-close").addEventListener("click", () => drawer.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    msg.textContent = "Placing your order…";
    try {
      const d = await api("/api/order", { body: { username: f.get("username"), email: f.get("email"), items: cart } });
      cart = []; persist(); draw();
      msg.textContent = "Order #" + d.id + " received (" + money(d.total) + "). Open a ticket in #support on Discord with this number to pay and claim it.";
      if (C.paypalMe) msg.append(" ", h("a", { href: C.paypalMe + "/" + d.total, target: "_blank", rel: "noopener", class: "white" }, "Pay with PayPal ↗"));
    } catch (err) { msg.textContent = err.message; }
  });
  draw();
})();
