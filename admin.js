(function () {
  const { h, api } = UI;
  const root = document.getElementById("admin-root");
  const logout = document.getElementById("logout");
  let data = null, tab = "gallery", note = "";

  const call = (url, body) => api(url, { body });
  logout.addEventListener("click", async () => { try { await api("/api/auth/logout", { body: {} }); } catch (e) {} location.href = "login.html"; });

  async function start() {
    try { data = await call("/api/admin/data"); } catch (e) { return root.replaceChildren(h("div", { class: "card" }, e.message)); }
    if (data.owner) { try { data.admins = (await api("/api/admin/admins")).admins; } catch (e) { data.admins = []; } }
    logout.hidden = false;
    draw();
  }

  let toastTimer = null;
  function toast(msg, bad) {
    if (!msg) return;
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
    t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = "toast"), 3500);
  }
  async function act(url, body, okMsg) {
    const y = window.scrollY;
    try { await call(url, body); note = okMsg || ""; await start(); toast(okMsg); }
    catch (e) { note = e.message; draw(); toast(e.message, true); }
    window.scrollTo(0, y);
  }
  const when = (t) => new Date(t).toLocaleString();
  const btn = (label, fn, cls) => h("button", { type: "button", class: "mini " + (cls || ""), onclick: fn }, label);

  function galleryTab() {
    const rows = data.gallery.slice().sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1) || b.id - a.id);
    return rows.length ? rows.map((g) => h("div", { class: "card admin-row" },
      h("img", { src: g.thumb, alt: "", referrerpolicy: "no-referrer", class: "admin-thumb" }),
      h("div", { style: "flex:1;min-width:12rem" }, h("h3", {}, g.title), h("p", { class: "mono small" }, g.player + " · " + g.kind + " · 👍 " + g.votes), g.caption ? h("p", {}, g.caption) : null,
        h("a", { href: g.kind === "youtube" ? "https://youtu.be/" + g.url : g.url, target: "_blank", rel: "noopener", class: "mono small white" }, "Open original ↗")),
      h("div", { class: "row" }, h("span", { class: "tag-top" }, g.status),
        g.status === "pending" ? btn("APPROVE", () => act("/api/admin/gallery", { id: g.id, action: "approve" }, "Approved.")) : btn("HIDE", () => act("/api/admin/gallery", { id: g.id, action: "unapprove" }, "Hidden.")),
        btn("DELETE", () => confirm("Delete this for good?") && act("/api/admin/gallery", { id: g.id, action: "delete" }, "Deleted."), "danger")))) : [h("p", { class: "muted" }, "Nothing submitted yet.")];
  }

  function appsTab() {
    return data.applications.length ? data.applications.slice().reverse().map((a) => {
      const noteIn = h("textarea", { rows: 2, maxlength: 1000, placeholder: "Private note" }, a.note || "");
      return h("div", { class: "card stack" },
        h("div", { class: "row between" }, h("h3", {}, a.name), h("span", { class: "tag-top" }, a.status)),
        h("p", { class: "mono small muted" }, "Minecraft: " + a.minecraft + " · Discord: " + a.discord + " · " + when(a.created)),
        ...a.answers.map((x) => h("div", {}, h("p", { class: "mono small muted" }, x.question), h("p", { style: "color:var(--text);white-space:pre-wrap;word-break:break-word" }, x.answer || "—"))),
        noteIn,
        h("div", { class: "row" },
          ["pending", "shortlisted", "accepted", "declined"].map((s) => btn(s.toUpperCase(), () => act("/api/admin/application", { id: a.id, status: s, note: noteIn.value }, "Saved."), a.status === s ? "on" : "")),
          btn("SAVE NOTE", () => act("/api/admin/application", { id: a.id, note: noteIn.value }, "Note saved.")),
          btn("DELETE", () => confirm("Delete this application?") && act("/api/admin/application", { id: a.id, delete: true }, "Deleted."), "danger")));
    }) : [h("p", { class: "muted" }, "No applications yet.")];
  }

  function ordersTab() {
    return data.orders.length ? data.orders.slice().reverse().map((o) => h("div", { class: "card admin-row" },
      h("div", { style: "flex:1;min-width:12rem" }, h("h3", {}, "#" + o.id + " · " + o.username), h("p", { class: "mono small muted" }, when(o.created) + (o.email ? " · " + o.email : "")), h("p", {}, o.items.map((i) => i.qty + "× " + i.name).join(", ")), h("p", { class: "mono white" }, o.totalText || "$" + o.total.toFixed(2))),
      h("div", { class: "row" }, h("span", { class: "tag-top" }, o.status),
        ["pending", "paid", "delivered"].map((s) => btn(s.toUpperCase(), () => act("/api/admin/order", { id: o.id, status: s }, "Updated."), o.status === s ? "on" : "")),
        btn("DELETE", () => confirm("Delete this order?") && act("/api/admin/order", { id: o.id, delete: true }, "Deleted."), "danger")))) : [h("p", { class: "muted" }, "No orders yet.")];
  }

  function announceTab() {
    const a = data.announcement || {};
    const f = { message: h("input", { maxlength: 200, placeholder: "Message", value: a.message || "" }), tag: h("input", { maxlength: 20, placeholder: "Tag (e.g. NEW)", value: a.tag || "" }),
      url: h("input", { type: "url", placeholder: "Link (optional)", value: a.link_url || "" }), label: h("input", { maxlength: 20, placeholder: "Link label", value: a.link_label || "" }),
      active: h("input", { type: "checkbox", checked: !!a.active }) };
    return [h("div", { class: "card stack", style: "max-width:36rem" }, f.message, f.tag, f.url, f.label,
      h("label", { class: "check" }, f.active, " Show on the site"),
      btn("SAVE", () => act("/api/admin/announcement", { message: f.message.value, tag: f.tag.value, link_url: f.url.value, link_label: f.label.value, active: f.active.checked }, "Announcement saved."), "on"))];
  }

  // ----- console: a terminal-style box. Built once, so what you typed is still there when you come back to this tab -----
  let term = null;
  function consoleTab() {
    if (term) { setTimeout(() => term.input.focus(), 0); return [term.wrap]; }
    const out = h("div", { class: "term-out", role: "log", "aria-live": "polite", tabindex: "0" });
    const input = h("input", { class: "term-in", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Console command", placeholder: "type a command, or help" });
    let hist = []; try { hist = JSON.parse(localStorage.getItem("vsmp_term_hist") || "[]"); } catch (e) {}
    let pos = hist.length, busy = false;
    const line = (text, cls) => { out.append(h("div", { class: "term-line " + (cls || "") }, text)); out.scrollTop = out.scrollHeight; };
    const hide = (c) => c.replace(/^(resetpw\s+\S+\s+).*/i, "$1***"); // never keep a password on screen or in history
    line("VSMP console. Type help to see what you can do. Commands run on the live site.", "dim");
    async function run(cmd) {
      cmd = cmd.trim(); if (!cmd || busy) return;
      hist.push(hide(cmd)); hist = hist.slice(-60); pos = hist.length;
      try { localStorage.setItem("vsmp_term_hist", JSON.stringify(hist)); } catch (e) {}
      line("> " + hide(cmd), "cmd");
      if (cmd.toLowerCase() === "clear") { out.replaceChildren(); return; }
      busy = true; input.disabled = true;
      try { const d = await call("/api/admin/console", { command: cmd }); line(d.text || "(done)", d.error ? "bad" : ""); }
      catch (e) { line(e.message, "bad"); }
      busy = false; input.disabled = false; input.focus();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const v = input.value; input.value = ""; run(v); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (pos > 0) input.value = hist[--pos]; }
      else if (e.key === "ArrowDown") { e.preventDefault(); pos = Math.min(hist.length, pos + 1); input.value = hist[pos] || ""; }
    });
    const wrap = h("div", { class: "term", onclick: () => input.focus() }, out, h("div", { class: "term-row" }, h("span", { class: "term-prompt" }, ">"), input));
    term = { wrap, input };
    setTimeout(() => input.focus(), 0);
    return [wrap];
  }

  const PERM_LABELS = { gallery: "Gallery: approve, hide and delete moments", applications: "Staff applications: read and decide", orders: "Orders: mark paid and delivered", announcement: "Announcement bar", questions: "Edit the application questions", chat: "Chat moderator: delete anyone's messages", console: "Console: run commands, including Minecraft server commands (powerful, give with care)" };
  function permBoxes(allPerms, have) {
    const boxes = {};
    const nodes = allPerms.map((p) => { boxes[p] = h("input", { type: "checkbox", checked: have.includes(p) }); return h("label", { class: "check" }, boxes[p], " " + (PERM_LABELS[p] || p)); });
    return { nodes, get: () => allPerms.filter((p) => boxes[p].checked) };
  }
  function adminsTab() {
    const all = data.allPerms || Object.keys(PERM_LABELS);
    const email = h("input", { type: "email", placeholder: "person@example.com", maxlength: 130 });
    const pw = h("input", { type: "text", placeholder: "Password you give them (8+ characters)", maxlength: 100 });
    const newPerms = permBoxes(all, all.filter((p) => p !== "console")); // the console is only given on purpose
    const resetEmail = h("input", { type: "email", placeholder: "member@example.com", maxlength: 130 });
    const resetPw = h("input", { type: "text", placeholder: "New password (8+ characters)", maxlength: 100 });
    return [
      h("div", { class: "card stack", style: "max-width:40rem" },
        h("h3", {}, "Admins and what they can do"),
        h("p", { class: "muted" }, "Tick what each person may manage. They only see the tabs you allow, and the server enforces it. You are the owner and can do everything."),
        h("div", { class: "row between" }, h("span", { class: "mono white" }, data.me), h("span", { class: "tag-top" }, "owner"))),
      ...(data.admins || []).map((a) => {
        const pb = permBoxes(all, a.perms);
        const status = h("span", { class: "mono small", "aria-live": "polite" }, "");
        const savebtn = btn("SAVE PERMISSIONS", async () => {
          status.textContent = "Saving…"; savebtn.disabled = true;
          try {
            const d = await call("/api/admin/admins", { email: a.email, permissions: pb.get(), action: "perms" });
            data.admins = d.admins; status.textContent = "Saved ✓"; status.style.color = "#57F287"; toast("Permissions saved for " + a.email + ".");
          } catch (e) { status.textContent = e.message; status.style.color = "var(--pink)"; toast(e.message, true); }
          savebtn.disabled = false;
        }, "on");
        return h("div", { class: "card stack", style: "max-width:40rem" }, h("span", { class: "mono" }, a.email), ...pb.nodes,
          h("div", { class: "row" },
            savebtn, status,
            btn("REMOVE ADMIN", () => confirm("Remove " + a.email + " as admin?") && act("/api/admin/admins", { email: a.email, action: "remove" }, "Removed."), "danger")));
      }),
      h("div", { class: "card stack", style: "max-width:40rem" }, h("h3", {}, "Reset a member's password"),
        h("p", { class: "muted" }, "Forgotten password, or locked out by 'too many tries'? Type their email and a new password, then give it to them. This also lifts the lock right away. If the account doesn't exist yet, it gets created."),
        resetEmail, resetPw,
        btn("RESET PASSWORD", () => resetEmail.value.trim() && act("/api/admin/reset-member", { email: resetEmail.value, password: resetPw.value }, "Done. Give them the email and the new password."), "on")),
      h("div", { class: "card stack", style: "max-width:40rem" }, h("h3", {}, "Add an admin"),
        h("p", { class: "muted" }, "You create their account and give them the password, so nobody can sign up as an admin. Adding an email that already has an account resets its password."),
        email, pw, ...newPerms.nodes,
        btn("ADD ADMIN", () => email.value.trim() && act("/api/admin/admins", { email: email.value, password: pw.value, permissions: newPerms.get(), action: "add" }, "Admin added. Give them the email and password."), "on"))
    ];
  }

  function questionsTab() {
    const qs = data.questions.map((q) => Object.assign({}, q));
    const save = () => act("/api/admin/questions", { questions: qs }, "Questions saved.");
    const add = { step: h("input", { placeholder: "Step name", maxlength: 40 }), order: h("input", { type: "number", placeholder: "Step #", value: 1 }), label: h("input", { placeholder: "Question", maxlength: 160 }),
      type: h("select", {}, ["text", "paragraph", "select", "checkbox", "screenshot"].map((t) => h("option", { value: t }, t))), opts: h("input", { placeholder: "Options, comma separated (select only)" }), req: h("input", { type: "checkbox" }) };
    return [
      ...qs.map((q, i) => h("div", { class: "card admin-row" }, h("div", { style: "flex:1" }, h("p", { class: "mono small muted" }, "Step " + q.step_order + " · " + q.step + " · " + q.type + (q.required ? " · required" : "")), h("p", { style: "color:var(--text)" }, q.label)),
        btn("DELETE", () => { qs.splice(i, 1); save(); }, "danger"))),
      h("div", { class: "card stack" }, h("h3", {}, "Add a question"), add.step, add.order, add.label, add.type, add.opts, h("label", { class: "check" }, add.req, " Required"),
        btn("ADD", () => { if (!add.label.value.trim()) return; qs.push({ id: "q" + Date.now().toString(36), step: add.step.value || "Questions", step_order: Number(add.order.value) || 1, label: add.label.value, hint: "", type: add.type.value, options: add.opts.value.split(",").map((s) => s.trim()).filter(Boolean), required: add.req.checked }); save(); }, "on"))
    ];
  }

  function draw() {
    const has = (p) => (data.perms || []).includes(p);
    const tabs = [].concat(
      has("gallery") ? [["gallery", "Gallery", data.gallery.filter((g) => g.status === "pending").length]] : [],
      has("applications") ? [["apps", "Applications", data.applications.filter((a) => a.status === "pending").length]] : [],
      has("orders") ? [["orders", "Orders", data.orders.filter((o) => o.status === "pending").length]] : [],
      has("announcement") ? [["announce", "Announcement", 0]] : [],
      has("questions") ? [["questions", "Questions", 0]] : [],
      has("console") ? [["console", "Console", 0]] : [],
      data.owner ? [["admins", "Admins", 0]] : []);
    if (!tabs.some((t) => t[0] === tab)) tab = tabs.length ? tabs[0][0] : "";
    if (!tabs.length) { root.replaceChildren(h("div", { class: "card muted" }, "You don't have permission to manage anything yet. Ask the owner.")); return; }
    const view = { gallery: galleryTab, apps: appsTab, orders: ordersTab, announce: announceTab, questions: questionsTab, console: consoleTab, admins: adminsTab }[tab]();
    root.replaceChildren(...[
      h("div", { class: "skin-btns", style: "margin-bottom:24px" }, tabs.map(([k, label, n]) => h("button", { type: "button", class: k === tab ? "on" : "", onclick: () => { tab = k; note = ""; draw(); } }, label + (n ? " (" + n + ")" : "")))),
      note ? h("p", { class: "mono small white", style: "margin-bottom:16px" }, note) : null,
      h("div", { class: "stack" }, view)].filter(Boolean));
  }
  start();
})();
