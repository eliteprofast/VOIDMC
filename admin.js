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

  // ----- leaderboard: add or fix players by hand, paste a list, and see how the server can send updates itself -----
  let lbCache = null;
  function leaderboardTab() {
    if (!lbCache) { call("/api/admin/leaderboard").then((d) => { lbCache = d; draw(); }).catch((e) => toast(e.message, true)); return [h("p", { class: "muted" }, "Loading the leaderboard…")]; }
    const reload = () => { lbCache = null; };
    const f = {};
    ["name", "clan", "balance", "kills", "deaths", "playtime"].forEach((k) => (f[k] = h("input", { placeholder: { name: "Minecraft name", clan: "Clan (optional)", balance: "Balance, e.g. 148240900", kills: "Kills", deaths: "Deaths", playtime: "Playtime in hours" }[k], maxlength: 24, inputmode: k === "name" || k === "clan" ? "text" : "decimal" })));
    const csv = h("textarea", { rows: 6, placeholder: "name,clan,balance,kills,deaths,playtime\nDrDonut,DONUT,148240900,84291,12488,2847\nClownPierce,CLOWNS,121600000,79882,10940,2100" });
    const fill = (p) => { f.name.value = p.name; f.clan.value = p.clan; f.balance.value = p.balance; f.kills.value = p.kills; f.deaths.value = p.deaths; f.playtime.value = p.playtime; f.name.scrollIntoView({ block: "center" }); };
    const importCsv = () => {
      const rows = csv.value.split(/\r?\n/).map((l) => l.split(/[,\t;]/).map((x) => x.trim())).filter((c) => c[0] && c[0].toLowerCase() !== "name").map((c) => ({ name: c[0], clan: c[1], balance: c[2], kills: c[3], deaths: c[4], playtime: c[5] }));
      if (!rows.length) return toast("Paste at least one line first.", true);
      reload(); act("/api/admin/leaderboard", { action: "upsert", rows }, rows.length + " line(s) sent. Check the table below for any that were refused.");
    };
    const origin = location.origin;
    return [
      h("div", { class: "card stack", style: "max-width:46rem" }, h("h3", {}, "Add or update a player"),
        h("p", { class: "muted" }, "Type a Minecraft name and any numbers you have. If the player is already listed, only the boxes you fill in change."),
        ...Object.values(f),
        btn("SAVE PLAYER", () => { const row = {}; Object.keys(f).forEach((k) => { if (f[k].value.trim() !== "") row[k] = f[k].value.trim(); }); if (!row.name) return toast("Enter a Minecraft name.", true); reload(); act("/api/admin/leaderboard", { action: "upsert", rows: [row] }, "Saved " + row.name + "."); }, "on")),
      h("div", { class: "card stack", style: "max-width:46rem" }, h("h3", {}, "Paste a list"),
        h("p", { class: "muted" }, "One player per line: name, clan, balance, kills, deaths, playtime. Commas, tabs or semicolons all work, and a header line is fine."), csv, btn("IMPORT LIST", importCsv, "on")),
      h("div", { class: "card stack", style: "max-width:46rem" }, h("h3", {}, "Let the server send updates by itself"),
        h("p", { class: "muted" }, lbCache.keySet ? "Automatic updates are ON. Your server (a plugin or script) sends the numbers here, using the secret key you set as LEADERBOARD_KEY in Render:" : "Automatic updates are OFF. In Render → Environment add LEADERBOARD_KEY (any long secret, at least 16 characters), save, then your server can send the numbers here:"),
        h("pre", { class: "md-pre" }, "POST " + origin + "/api/leaderboard/update\nAuthorization: Bearer <your LEADERBOARD_KEY>\nContent-Type: application/json\n\n{\"players\":[{\"name\":\"DrDonut\",\"clan\":\"DONUT\",\"balance\":148240900,\"kills\":84291,\"deaths\":12488,\"playtime\":2847}]}"),
        h("p", { class: "mono small muted" }, "Up to 100 players per request. Names are Minecraft names; only the fields you send are changed.")),
      h("div", { class: "card stack", style: "max-width:60rem" }, h("h3", {}, "Players (" + lbCache.count + ")"),
        lbCache.players.length ? h("div", { class: "stack" }, lbCache.players.map((p) => h("div", { class: "row between" },
          h("span", { class: "mono small" }, "#" + p.rank + "  " + p.name + (p.clan ? "  [" + p.clan + "]" : "") + "  bal " + p.balance + "  K " + p.kills + "  D " + p.deaths + "  " + p.playtime + "h"),
          h("span", { class: "row" }, btn("EDIT", () => fill(p)), btn("REMOVE", () => confirm("Remove " + p.name + " from the leaderboard?") && (reload(), act("/api/admin/leaderboard", { action: "delete", name: p.name }, "Removed " + p.name + "."))), "danger")))) : h("p", { class: "muted" }, "Nobody yet."),
        lbCache.players.length ? btn("CLEAR THE WHOLE LEADERBOARD", () => confirm("Remove ALL players from the leaderboard?") && (reload(), act("/api/admin/leaderboard", { action: "clear" }, "Leaderboard cleared.")), "danger") : null)
    ].filter(Boolean);
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

  const PERM_LABELS = { gallery: "Gallery: approve, hide and delete moments", applications: "Staff applications: read and decide", orders: "Orders: mark paid and delivered", announcement: "Announcement bar", questions: "Edit the application questions", chat: "Chat moderator: delete anyone's messages", leaderboard: "Leaderboard: add, import and remove players", console: "Console: run commands, including Minecraft server commands (powerful, give with care)" };
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
      has("leaderboard") ? [["leaderboard", "Leaderboard", 0]] : [],
      has("console") ? [["console", "Console", 0]] : [],
      data.owner ? [["admins", "Admins", 0]] : []);
    if (!tabs.some((t) => t[0] === tab)) tab = tabs.length ? tabs[0][0] : "";
    if (!tabs.length) { root.replaceChildren(h("div", { class: "card muted" }, "You don't have permission to manage anything yet. Ask the owner.")); return; }
    const view = { gallery: galleryTab, apps: appsTab, orders: ordersTab, announce: announceTab, questions: questionsTab, leaderboard: leaderboardTab, console: consoleTab, admins: adminsTab }[tab]();
    root.replaceChildren(...[
      h("div", { class: "skin-btns", style: "margin-bottom:24px" }, tabs.map(([k, label, n]) => h("button", { type: "button", class: k === tab ? "on" : "", onclick: () => { tab = k; note = ""; draw(); } }, label + (n ? " (" + n + ")" : "")))),
      note ? h("p", { class: "mono small white", style: "margin-bottom:16px" }, note) : null,
      h("div", { class: "stack" }, view)].filter(Boolean));
  }
  start();
})();
