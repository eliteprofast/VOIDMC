// Live chat panel: a real-time mirror of the Discord server. Everything is built with textContent (never innerHTML).
(function () {
  const { h, api } = UI;
  const C = window.VSMP || {};
  const colorOk = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "");
  const fmt = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };

  function mount(host, opts) {
    opts = opts || {};
    const st = { groups: [], channel: null, channelName: "", voice: false, canPost: false, tab: "chat", name: "", online: 0, last: "", seen: new Set(), authors: new Map(), replyTo: null, picks: {}, timer: null, busy: false, polls: 0, open: false, pending: [] };

    // ----- shell -----
    const dot = h("span", { class: "chat-dot" });
    const title = h("span", { class: "chat-title" }, "VSMP Live Chat");
    const chName = h("span", { class: "chat-chname mono" });
    const tabChat = h("button", { type: "button", class: "chat-tab on", onclick: () => setTab("chat") }, "Chat");
    const tabMem = h("button", { type: "button", class: "chat-tab", onclick: () => setTab("members") }, "Members ", h("span", { class: "chat-online" }, ""));
    const strip = h("div", { class: "chat-strip" });
    const list = h("div", { class: "chat-list" });
    const memList = h("div", { class: "chat-members", hidden: true });
    const replyBar = h("div", { class: "chat-reply", hidden: true });
    const voiceNote = h("div", { class: "chat-voice mono small", hidden: true });
    const mentionBox = h("div", { class: "chat-mentions", hidden: true });
    const input = h("input", { class: "chat-input", maxlength: 1500, placeholder: "Message…", autocomplete: "off", "aria-label": "Message" });
    const sendBtn = h("button", { class: "chat-send", type: "submit" }, "SEND");
    const note = h("div", { class: "chat-note mono small" });
    const form = h("form", { class: "chat-form", onsubmit: onSend }, input, sendBtn);
    const nameIn = h("input", { class: "chat-input", maxlength: 24, placeholder: "Pick a chat name (2-24 characters)" });
    const nameForm = h("form", { class: "chat-form", hidden: true, onsubmit: onName }, nameIn, h("button", { class: "chat-send", type: "submit" }, "OK"));
    const btnZoom = h("button", { type: "button", class: "chat-ic", "aria-label": "Enlarge", onclick: () => root.classList.toggle("zoom") }, "⤢");
    const btnTab = h("a", { class: "chat-ic", "aria-label": "Open in a new tab", target: "_blank", rel: "noopener", href: "chat.html" }, "↗");
    const btnClose = h("button", { type: "button", class: "chat-ic", "aria-label": "Close", onclick: () => api_.close() }, "✕");
    const head = h("div", { class: "chat-head" }, dot, h("div", { class: "chat-ttl" }, title, chName), h("div", { class: "chat-acts" }, btnTab, opts.standalone ? null : btnZoom, opts.standalone ? null : btnClose));
    const root = h("div", { class: "chat" + (opts.standalone ? " standalone" : ""), hidden: !opts.standalone }, head, h("div", { class: "chat-tabs" }, tabChat, tabMem), strip, list, memList, voiceNote, replyBar, mentionBox, note, form, nameForm);
    host.append(root);

    const say = (t) => { note.textContent = t || ""; };
    const stick = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;

    // ----- loading channels -----
    async function loadChannels() {
      try {
        const d = await api("/api/chat/channels");
        st.groups = d.groups; st.name = d.name || ""; st.online = d.online;
        tabMem.querySelector(".chat-online").textContent = d.online ? d.online + " online" : "";
        drawStrip(); drawComposer();
        const flat = d.groups.flatMap((g) => g.channels);
        const want = new URLSearchParams(location.search).get("channel");
        const first = flat.find((c) => c.id === want) || flat.find((c) => c.type === 0 || c.type === 5) || flat[0];
        if (first) pick(first.id); else list.replaceChildren(h("p", { class: "chat-empty" }, "No channels are available to view right now."));
      } catch (e) { list.replaceChildren(h("p", { class: "chat-empty" }, e.message)); }
    }
    function drawStrip() {
      strip.replaceChildren(...st.groups.map((g) => h("div", { class: "chat-group" }, h("span", { class: "chat-glabel mono" }, g.name),
        g.channels.map((c) => h("button", { type: "button", class: "chat-ch" + (c.id === st.channel ? " on" : ""), onclick: () => pick(c.id) }, (c.type === 2 || c.type === 13 ? "🔊 " : "# ") + c.name)))));
    }
    function drawComposer() {
      const needName = !st.name;
      nameForm.hidden = !needName;
      form.hidden = needName || !st.canPost;
      if (!needName && !st.canPost && st.channel) say("You can read this channel but can't post in it.");
    }
    async function onName(e) {
      e.preventDefault();
      try { const d = await api("/api/chat/name", { body: { name: nameIn.value } }); st.name = d.name; say(""); drawComposer(); input.focus(); } catch (x) { say(x.message); }
    }

    // ----- channel + messages -----
    function pick(id) {
      const c = st.groups.flatMap((g) => g.channels).find((x) => x.id === id);
      if (!c) return;
      st.channel = id; st.channelName = c.name; st.voice = c.type === 2 || c.type === 13; st.canPost = c.canPost;
      st.last = ""; st.seen = new Set(); st.pending = []; st.replyTo = null; replyBar.hidden = true; st.polls = 0; st.busy = false;
      chName.textContent = (st.voice ? "voice · " : "# ") + c.name;
      voiceNote.hidden = !st.voice;
      if (st.voice) voiceNote.replaceChildren("Voice calls happen in Discord. ", h("a", { href: C.discord || "#", target: "_blank", rel: "noopener", class: "white" }, "Join the call in Discord ↗"), " (this room's text chat works here).");
      drawStrip(); drawComposer(); say("");
      list.replaceChildren(h("p", { class: "chat-empty" }, "Loading messages…"));
      setTab("chat"); fetchMessages(true);
    }
    async function fetchMessages(full) {
      if (st.busy || !st.channel) return;
      st.busy = true;
      const ch = st.channel;
      try {
        const d = await api("/api/chat/messages?channel=" + ch + (!full && st.last ? "&after=" + st.last : ""));
        if (ch !== st.channel) return;
        if (full) { st.seen = new Set(); list.replaceChildren(); }
        const wasBottom = full || stick();
        let added = 0;
        d.messages.forEach((m) => { if (st.seen.has(m.id)) return; addMsg(m); added++; });
        if (d.last) st.last = d.last;
        if (full && !d.messages.length) list.replaceChildren(h("p", { class: "chat-empty" }, "No messages here yet. Say hello!"));
        if (added && wasBottom) list.scrollTop = list.scrollHeight;
        dot.classList.add("on");
      } catch (e) { dot.classList.remove("on"); if (full && ch === st.channel) list.replaceChildren(h("p", { class: "chat-empty" }, e.message)); }
      finally { st.busy = false; }
    }
    function addMsg(m, pending) {
      const empty = list.querySelector(".chat-empty"); if (empty) empty.remove();
      if (!pending) st.seen.add(m.id);
      if (m.author.id) st.authors.set(m.author.id, m.author.name);
      const el = msgEl(m, pending);
      const firstPending = list.querySelector(".msg.pending");
      if (!pending && firstPending) list.insertBefore(el, firstPending); else list.append(el);
      return el;
    }
    function msgEl(m, pending) {
      const col = colorOk(m.author.color);
      const avatar = m.author.avatar ? h("img", { class: "msg-av", src: m.author.avatar, alt: "", loading: "lazy" }) : h("span", { class: "msg-av ini" }, (m.author.name || "?").slice(0, 1).toUpperCase());
      const acts = pending ? null : h("div", { class: "msg-acts" },
        st.canPost ? h("button", { type: "button", title: "Reply", onclick: () => setReply(m) }, "↩") : null,
        h("button", { type: "button", title: "Forward", onclick: () => forward(m) }, "↪"),
        m.canDelete ? h("button", { type: "button", title: "Delete", onclick: () => del(m, el) }, "🗑") : null);
      const el = h("div", { class: "msg" + (pending ? " pending" : ""), "data-id": m.id }, avatar, h("div", { class: "msg-body" },
        m.reply ? h("div", { class: "msg-quote" }, "↩ ", h("strong", {}, m.reply.author), " " + m.reply.text) : null,
        h("div", { class: "msg-head" }, h("span", { class: "msg-name", style: col ? "color:" + col : null }, m.author.name),
          m.author.bot && !m.web ? h("span", { class: "msg-tag" }, "BOT") : null, m.web ? h("span", { class: "msg-tag" }, "WEB") : null,
          h("span", { class: "msg-time mono" }, pending ? "sending…" : fmt(m.ts))),
        m.content ? h("div", { class: "msg-text" }, m.content) : null,
        (m.images || []).map((u) => h("img", { class: "msg-img", src: u, alt: "attachment", loading: "lazy" })),
        (m.embeds || []).map(embedEl)), acts);
      return el;
    }
    function embedEl(e) {
      const bar = colorOk(e.color);
      return h("div", { class: "msg-embed", style: bar ? "border-left-color:" + bar : null },
        e.author ? h("div", { class: "mono small muted" }, e.author) : null,
        e.title ? (e.url ? h("a", { href: e.url, target: "_blank", rel: "noopener", class: "emb-title" }, e.title) : h("div", { class: "emb-title" }, e.title)) : null,
        e.description ? h("div", { class: "msg-text" }, e.description) : null,
        e.fields.map((f) => h("div", {}, h("strong", {}, f.name), h("div", { class: "msg-text" }, f.value))),
        e.image ? h("img", { class: "msg-img", src: e.image, alt: "", loading: "lazy" }) : null,
        e.thumbnail && !e.image ? h("img", { class: "msg-thumb", src: e.thumbnail, alt: "", loading: "lazy" }) : null,
        e.footer ? h("div", { class: "mono small muted" }, e.footer) : null);
    }

    // ----- sending (optimistic) -----
    let pid = 0;
    async function onSend(e) {
      e.preventDefault();
      let text = input.value.trim();
      if (!text || !st.channel) return;
      const mentions = [];
      Object.keys(st.picks).forEach((n) => { const re = new RegExp("@" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])", "g"); if (re.test(text)) { text = text.replace(re, "<@" + st.picks[n] + ">"); mentions.push(st.picks[n]); } });
      const shown = input.value.trim();
      input.value = ""; say("");
      const reply = st.replyTo; setReply(null);
      const el = addMsg({ id: "p" + ++pid, author: { id: "", name: st.name, avatar: "", color: "", bot: false }, content: shown, images: [], embeds: [], reply: reply ? { author: reply.author.name, text: reply.content.slice(0, 120) } : null, ts: Date.now() }, true);
      list.scrollTop = list.scrollHeight;
      try {
        const d = await api("/api/chat/send", { body: { channel: st.channel, text, mentions, replyTo: reply ? reply.id : undefined } });
        el.remove();
        if (d.message && !st.seen.has(d.message.id)) { d.message.content = shown; addMsg(d.message); list.scrollTop = list.scrollHeight; }
      } catch (x) { el.remove(); say(x.message || "Your message could not be sent."); input.value = shown; }
      st.picks = {};
    }
    function setReply(m) {
      st.replyTo = m;
      replyBar.hidden = !m;
      if (m) { replyBar.replaceChildren(h("span", {}, "Replying to ", h("strong", {}, m.author.name), ": " + m.content.slice(0, 80)), h("button", { type: "button", class: "chat-ic", onclick: () => setReply(null) }, "✕")); input.focus(); }
    }
    async function del(m, el) {
      if (!confirm("Delete this message?")) return;
      try { await api("/api/chat/delete", { body: { channel: st.channel, id: m.id } }); el.remove(); } catch (x) { say(x.message); }
    }
    function forward(m) {
      const targets = st.groups.flatMap((g) => g.channels).filter((c) => c.canPost);
      const box = h("div", { class: "chat-dialog", onclick: (e) => { if (e.target === box) box.remove(); } }, h("div", { class: "chat-dialog-in" }, h("strong", {}, "Forward to…"),
        ...targets.map((c) => h("button", { type: "button", class: "chat-ch", onclick: async () => { try { await api("/api/chat/forward", { body: { channel: st.channel, id: m.id, to: c.id } }); say("Forwarded to #" + c.name); } catch (x) { say(x.message); } box.remove(); } }, "# " + c.name)),
        h("button", { type: "button", class: "chat-ch", onclick: () => box.remove() }, "Cancel")));
      root.append(box);
    }

    // ----- @mention autocomplete (people who have spoken here) -----
    input.addEventListener("input", () => {
      const m = /(?:^|\s)@([\w.\- ]{0,20})$/.exec(input.value.slice(0, input.selectionStart));
      if (!m) { mentionBox.hidden = true; return; }
      const q = m[1].toLowerCase();
      const found = [...st.authors.entries()].filter(([, n]) => n.toLowerCase().startsWith(q)).slice(0, 6);
      mentionBox.hidden = !found.length;
      mentionBox.replaceChildren(...found.map(([id, n]) => h("button", { type: "button", class: "chat-ch", onclick: () => {
        const pos = input.selectionStart, before = input.value.slice(0, pos).replace(/@[\w.\- ]{0,20}$/, "@" + n + " ");
        input.value = before + input.value.slice(pos); st.picks[n] = id; mentionBox.hidden = true; input.focus();
      } }, "@" + n)));
    });

    // ----- members tab -----
    async function loadMembers() {
      memList.replaceChildren(h("p", { class: "chat-empty" }, "Loading members…"));
      try {
        const d = await api("/api/chat/members");
        tabMem.querySelector(".chat-online").textContent = d.online + " online";
        memList.replaceChildren(h("p", { class: "mono small", style: "color:#57F287;padding:8px 12px" }, d.online + " online · " + d.total + " members"),
          d.note ? h("p", { class: "chat-empty" }, d.note) : null,
          ...d.members.map((m) => h("div", { class: "mem" }, h("img", { class: "msg-av", src: m.avatar, alt: "", loading: "lazy" }), h("span", { style: colorOk(m.color) ? "color:" + m.color : null }, m.name), m.bot ? h("span", { class: "msg-tag" }, "BOT") : null)));
      } catch (e) { memList.replaceChildren(h("p", { class: "chat-empty" }, e.message)); }
    }
    function setTab(t) {
      st.tab = t;
      tabChat.classList.toggle("on", t === "chat"); tabMem.classList.toggle("on", t === "members");
      list.hidden = t !== "chat"; memList.hidden = t !== "members";
      form.hidden = t !== "chat" || !st.name || !st.canPost; nameForm.hidden = t !== "chat" || !!st.name;
      if (t === "members") loadMembers();
    }

    // ----- polling: only while open and visible; incremental via the "after" cursor -----
    function tick() {
      if (!st.open || document.visibilityState !== "visible" || st.tab !== "chat") return;
      st.polls++;
      fetchMessages(st.polls % 10 === 0); // every ~20s a full refresh so deleted/edited messages settle
    }
    const api_ = {
      open() { st.open = true; root.hidden = false; if (!st.groups.length) loadChannels(); else fetchMessages(false); clearInterval(st.timer); st.timer = setInterval(tick, 2000); if (opts.onOpen) opts.onOpen(); },
      close() { st.open = false; root.hidden = true; clearInterval(st.timer); if (opts.onClose) opts.onClose(); }
    };
    if (opts.standalone) api_.open();
    return api_;
  }

  window.VSMPChat = { mount };

  // floating panel on the home page
  const fab = document.getElementById("chat-fab");
  const host = document.getElementById("chat-root");
  if (fab && host) {
    let panel = null;
    const toggle = () => {
      if (!panel) panel = mount(host, { onOpen: () => fab.classList.add("hide"), onClose: () => fab.classList.remove("hide") });
      panel.open();
    };
    fab.addEventListener("click", toggle);
    if (new URLSearchParams(location.search).get("chat") === "1") toggle();
  }
  // full-page version
  const page = document.getElementById("chat-page");
  if (page) mount(page, { standalone: true });
})();
