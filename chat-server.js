// Live chat bridge to Discord. Every Discord call happens here, with the bot token. The browser never talks to Discord.
const crypto = require("crypto");

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const GUILD_ID = process.env.DISCORD_GUILD_ID || "1545479832769536073";
const API = (process.env.DISCORD_API || "https://discord.com/api/v10").replace(/\/+$/, "");
const ONLY = (process.env.CHAT_CHANNELS || "").split(",").map((s) => s.trim()).filter(Boolean); // optional allow-list of channel ids

const BIT = { ADMIN: 1n << 3n, VIEW: 1n << 10n, SEND: 1n << 11n, MANAGE_MSGS: 1n << 13n, READ_HISTORY: 1n << 16n };
const ALL = (1n << 53n) - 1n;
const CHAT_TYPES = [0, 5, 2, 13]; // text, announcement, voice, stage (voice and stage carry text chat too)
const MEDIA_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

// ---------- Discord REST ----------
async function dc(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { Authorization: "Bot " + TOKEN, "Content-Type": "application/json", "User-Agent": "DiscordBot (https://vsmp.local, 1.0)" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000)
  });
  if (r.status === 204) return {};
  let j = {};
  try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error("discord " + r.status); e.status = r.status; e.detail = j; throw e; }
  return j;
}
const friendly = (e) => (e && e.status === 429 ? "Chat is busy right now. Please try again in a moment." : "Chat is unavailable right now. Please try again in a little while.");

// ---------- cache of guild, channels, roles, bot ----------
let cache = { at: 0, data: null, loading: null };
async function guildData() {
  if (cache.data && Date.now() - cache.at < 60000) return cache.data;
  if (cache.loading) return cache.loading;
  cache.loading = (async () => {
    try {
      const [guild, channels, me] = await Promise.all([dc("GET", `/guilds/${GUILD_ID}?with_counts=true`), dc("GET", `/guilds/${GUILD_ID}/channels`), dc("GET", "/users/@me")]);
      let botMember = { roles: [] };
      try { botMember = await dc("GET", `/guilds/${GUILD_ID}/members/${me.id}`); } catch (e) {}
      cache = { at: Date.now(), data: { guild, channels, botId: me.id, botMember, roles: guild.roles || [] }, loading: null };
      return cache.data;
    } catch (e) { cache.loading = null; throw e; }
  })();
  return cache.loading;
}

// Discord's own permission algorithm
function permsFor(g, ch, userId, roleIds) {
  if (g.guild.owner_id === userId) return ALL;
  const everyone = g.roles.find((r) => r.id === GUILD_ID);
  let p = BigInt(everyone ? everyone.permissions : 0);
  for (const id of roleIds) { const r = g.roles.find((x) => x.id === id); if (r) p |= BigInt(r.permissions); }
  if (p & BIT.ADMIN) return ALL;
  if (!ch) return p;
  const ow = ch.permission_overwrites || [];
  const ev = ow.find((o) => o.id === GUILD_ID && Number(o.type) === 0);
  if (ev) { p &= ~BigInt(ev.deny); p |= BigInt(ev.allow); }
  let deny = 0n, allow = 0n;
  for (const o of ow) if (Number(o.type) === 0 && roleIds.includes(o.id)) { deny |= BigInt(o.deny); allow |= BigInt(o.allow); }
  p &= ~deny; p |= allow;
  const mo = userId && ow.find((o) => o.id === userId && Number(o.type) === 1);
  if (mo) { p &= ~BigInt(mo.deny); p |= BigInt(mo.allow); }
  return p;
}
const has = (p, b) => (p & b) === b;

// Channels a site member may use: ones @everyone can see, that the bot can also read.
function visibleChannels(g) {
  const botRoles = g.botMember.roles || [];
  return g.channels.filter((ch) => {
    if (!CHAT_TYPES.includes(ch.type)) return false;
    if (ONLY.length && !ONLY.includes(ch.id)) return false;
    const member = permsFor(g, ch, null, []);
    const bot = permsFor(g, ch, g.botId, botRoles);
    return has(member, BIT.VIEW) && has(bot, BIT.VIEW | BIT.READ_HISTORY);
  });
}
function canPost(g, ch) {
  return has(permsFor(g, ch, null, []), BIT.SEND) && has(permsFor(g, ch, g.botId, g.botMember.roles || []), BIT.SEND);
}
async function channelFor(id) {
  const g = await guildData();
  const ch = visibleChannels(g).find((c) => c.id === String(id));
  return { g, ch };
}

// ---------- members (names, avatars, role colours) ----------
let mcache = { at: 0, list: null, error: "" };
async function members(g) {
  if (mcache.list && Date.now() - mcache.at < 60000) return mcache;
  try {
    const list = await dc("GET", `/guilds/${GUILD_ID}/members?limit=1000`);
    mcache = { at: Date.now(), list, error: "" };
  } catch (e) {
    mcache = { at: Date.now(), list: [], error: e.status === 403 ? "needs-intent" : "unavailable" };
  }
  return mcache;
}
function nameColor(g, roleIds) {
  let best = null;
  for (const id of roleIds || []) { const r = g.roles.find((x) => x.id === id); if (r && r.color && (!best || r.position > best.position)) best = r; }
  return best ? "#" + best.color.toString(16).padStart(6, "0") : "";
}

// ---------- shaping Discord data for the browser ----------
const proxy = (u) => (u ? "api/chat/media?u=" + encodeURIComponent(u) : "");
function avatarUrl(u, size) {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=${size || 64}`;
  return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
}
function cleanText(text, m, g) {
  const names = {};
  (m.mentions || []).forEach((u) => (names[u.id] = (u.global_name || u.username)));
  return String(text || "")
    .replace(/<@!?(\d+)>/g, (_, id) => "@" + (names[id] || "someone"))
    .replace(/<@&(\d+)>/g, (_, id) => { const r = g.roles.find((x) => x.id === id); return "@" + (r ? r.name : "role"); })
    .replace(/<#(\d+)>/g, (_, id) => { const c = g.channels.find((x) => x.id === id); return "#" + (c ? c.name : "channel"); })
    .replace(/<a?:(\w+):\d+>/g, ":$1:")
    .replace(/<t:\d+(?::\w)?>/g, "")
    .slice(0, 4000);
}
function shapeEmbed(e) {
  const clr = (v) => (v ? proxy(v.proxy_url || v.url) : "");
  return {
    color: e.color ? "#" + e.color.toString(16).padStart(6, "0") : "",
    author: e.author ? String(e.author.name || "").slice(0, 120) : "",
    title: String(e.title || "").slice(0, 200), url: /^https?:\/\//.test(e.url || "") ? e.url : "",
    description: String(e.description || "").slice(0, 1200),
    fields: (e.fields || []).slice(0, 8).map((f) => ({ name: String(f.name).slice(0, 100), value: String(f.value).slice(0, 300) })),
    image: clr(e.image), thumbnail: clr(e.thumbnail), footer: e.footer ? String(e.footer.text || "").slice(0, 120) : ""
  };
}
function shapeMessage(m, g, memberMap, ctx) {
  if (![0, 19, 20].includes(m.type)) return null; // hide joins, pins, boosts and other system entries
  const embeds = (m.embeds || []).slice(0, 6).map(shapeEmbed);
  const images = (m.attachments || []).filter((a) => /^image\//.test(a.content_type || "")).slice(0, 6).map((a) => proxy(a.proxy_url || a.url));
  const content = cleanText(m.content, m, g);
  if (!content && !embeds.length && !images.length) return null;
  const uid = m.author.id;
  const mem = memberMap[uid];
  const post = ctx.db.chatPosts[m.id];
  let reply = null;
  if (m.referenced_message) {
    const rm = m.referenced_message;
    reply = { author: rm.author ? rm.author.global_name || rm.author.username : "someone", text: cleanText(rm.content || "(attachment)", rm, g).slice(0, 120) };
  }
  return {
    id: m.id, ts: m.timestamp, content, images, embeds, reply,
    author: { id: uid, name: (mem && mem.nick) || m.author.global_name || m.author.username, avatar: proxy(avatarUrl(m.author)), bot: !!m.author.bot || !!m.webhook_id, color: mem ? nameColor(g, mem.roles) : "" },
    web: !!post,
    canDelete: !!(ctx.me && (ctx.isAdmin || (post && post.email === ctx.me)))
  };
}

const small = new Map(); // short cache for message reads, shared by all viewers
async function readMessages(channelId, after) {
  const key = channelId + ":" + (after || "");
  const hit = small.get(key);
  if (hit && Date.now() - hit.at < 1500) return hit.data;
  const q = "limit=50" + (after ? "&after=" + after : "");
  const raw = await dc("GET", `/channels/${channelId}/messages?${q}`);
  const data = raw.reverse();
  small.set(key, { at: Date.now(), data });
  if (small.size > 200) for (const k of small.keys()) { small.delete(k); if (small.size < 100) break; }
  return data;
}

// ---------- webhooks (so a message wears the member's name) ----------
const hooks = new Map(); // channelId -> { id, token } | false
async function webhookFor(channelId) {
  if (hooks.has(channelId)) return hooks.get(channelId);
  let hook = false;
  try {
    const list = await dc("GET", `/channels/${channelId}/webhooks`);
    const mine = list.find((w) => w.name === "VSMP Chat" && w.token);
    hook = mine ? { id: mine.id, token: mine.token } : false;
    if (!hook) { const w = await dc("POST", `/channels/${channelId}/webhooks`, { name: "VSMP Chat" }); hook = { id: w.id, token: w.token }; }
  } catch (e) { hook = false; }
  hooks.set(channelId, hook);
  return hook;
}

// ---------- the route handler ----------
// Returns true when it handled the request. ctx: { me, isAdmin, send, body, db, save, limited, ip, req, res }
async function handle(url, ctx) {
  const { req, res, send, body, db, limited } = ctx;
  if (!url.startsWith("/api/chat/")) return false;
  if (!TOKEN) { send(res, 503, { error: "Chat isn't set up yet." }); return true; }
  const q = new URL(req.url, "http://x").searchParams;
  const user = db.users.find((u) => u.email === ctx.me);
  const fail = (e) => { console.log("[chat]", url, e.name === "TimeoutError" ? "timed out talking to Discord" : e.message, e.detail ? JSON.stringify(e.detail).slice(0, 200) : ""); return send(res, e.status === 429 ? 429 : 502, { error: friendly(e) }); };

  try {
    if (url === "/api/chat/channels" && req.method === "GET") {
      const g = await guildData();
      const vis = visibleChannels(g);
      const cats = g.channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
      const staff = (n) => /staff|admin|mod/i.test(n);
      const groups = [];
      const mk = (name, list) => { if (list.length) groups.push({ name, channels: list.sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name, type: c.type, canPost: canPost(g, c) })) }); };
      cats.sort((a, b) => Number(staff(b.name)) - Number(staff(a.name))).forEach((cat) => mk(cat.name, vis.filter((c) => c.parent_id === cat.id)));
      mk("Channels", vis.filter((c) => !c.parent_id || !cats.some((x) => x.id === c.parent_id)));
      return send(res, 200, { groups, online: g.guild.approximate_presence_count || 0, total: g.guild.approximate_member_count || 0, name: user && user.name || "" }), true;
    }

    if (url === "/api/chat/messages" && req.method === "GET") {
      if (limited("cm:" + ctx.me, 150, 60000)) return send(res, 429, { error: "Slow down a little." }), true;
      const { g, ch } = await channelFor(q.get("channel"));
      if (!ch) return send(res, 404, { error: "That channel isn't available." }), true;
      const after = /^\d{5,25}$/.test(q.get("after") || "") ? q.get("after") : "";
      const raw = await readMessages(ch.id, after);
      const mc = await Promise.race([members(g), new Promise((r) => setTimeout(() => r({ list: [] }), 2000))]);
      const map = {}; (mc.list || []).forEach((m) => m.user && (map[m.user.id] = m));
      const out = raw.map((m) => shapeMessage(m, g, map, ctx)).filter(Boolean);
      return send(res, 200, { messages: out, last: raw.length ? raw[raw.length - 1].id : after }), true;
    }

    if (url === "/api/chat/members" && req.method === "GET") {
      const g = await guildData();
      const mc = await members(g);
      const list = (mc.list || []).slice(0, 300).map((m) => ({ id: m.user.id, name: m.nick || m.user.global_name || m.user.username, avatar: proxy(avatarUrl(m.user)), bot: !!m.user.bot, color: nameColor(g, m.roles) }));
      list.sort((a, b) => Number(a.bot) - Number(b.bot) || a.name.localeCompare(b.name));
      return send(res, 200, { online: g.guild.approximate_presence_count || 0, total: g.guild.approximate_member_count || 0, members: list, note: mc.error === "needs-intent" ? "The member list is hidden. Turn on 'Server Members Intent' for the bot in the Discord Developer Portal." : mc.error ? "The member list is unavailable right now." : "" }), true;
    }

    if (url === "/api/chat/name" && req.method === "POST") {
      const n = String(body.name || "").replace(/[\u0000-\u001f\u007f@#:`*_~|>]/g, "").trim().slice(0, 24);
      if (n.length < 2) return send(res, 400, { error: "Pick a name with at least 2 characters." }), true;
      if (/discord|clyde|everyone|here/i.test(n)) return send(res, 400, { error: "Please pick a different name." }), true;
      user.name = n; ctx.save();
      return send(res, 200, { name: n }), true;
    }

    if (url === "/api/chat/send" && req.method === "POST") {
      if (!user || !user.name) return send(res, 400, { error: "Choose a chat name first." }), true;
      if (limited("cs:" + ctx.me, 12, 60000) || limited("csf:" + ctx.me, 1, 1200)) return send(res, 429, { error: "You're sending too fast." }), true;
      const { g, ch } = await channelFor(body.channel);
      if (!ch || !canPost(g, ch)) return send(res, 403, { error: "You can't post in that channel." }), true;
      const text = String(body.text || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1500);
      const image = /^https:\/\/[^\s]{1,400}$/.test(body.image || "") ? body.image : "";
      if (!text && !image) return send(res, 400, { error: "Write a message first." }), true;
      const picked = (Array.isArray(body.mentions) ? body.mentions : []).filter((x) => /^\d{5,25}$/.test(String(x))).slice(0, 10).map(String);
      // only user mentions the sender picked are allowed to ping
      const content = (text.replace(/<@&?!?\d+>/g, (t) => (/^<@!?(\d+)>$/.test(t) && picked.includes(t.replace(/\D/g, "")) ? t : "")) + (image ? "\n" + image : "")).trim();
      const allowed = { parse: [], users: picked };
      let sent;
      if (body.replyTo && /^\d{5,25}$/.test(String(body.replyTo))) {
        sent = await dc("POST", `/channels/${ch.id}/messages`, { content: `**${user.name}** · via website\n${content}`, allowed_mentions: Object.assign({ replied_user: false }, allowed), message_reference: { message_id: String(body.replyTo), channel_id: ch.id, fail_if_not_exists: false } });
      } else {
        const hook = await webhookFor(ch.id);
        if (hook) {
          const r = await fetch(`${API}/webhooks/${hook.id}/${hook.token}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, username: user.name.replace(/discord|clyde/gi, "***"), allowed_mentions: allowed }) });
          if (!r.ok) throw Object.assign(new Error("webhook " + r.status), { status: r.status });
          sent = await r.json(); sent.__hook = hook;
        } else sent = await dc("POST", `/channels/${ch.id}/messages`, { content: `**${user.name}** · via website\n${content}`, allowed_mentions: allowed });
      }
      db.chatPosts[sent.id] = { channel: ch.id, email: ctx.me, name: user.name, hook: sent.__hook ? sent.__hook.id + "/" + sent.__hook.token : "" };
      const keys = Object.keys(db.chatPosts); if (keys.length > 3000) keys.slice(0, keys.length - 2000).forEach((k) => delete db.chatPosts[k]);
      ctx.save();
      small.clear();
      const shaped = { id: sent.id, ts: sent.timestamp, content: cleanText(content, sent, g), images: [], embeds: [], reply: null, author: { id: "", name: user.name, avatar: "", bot: false, color: "" }, web: true, canDelete: true };
      return send(res, 200, { message: shaped }), true;
    }

    if (url === "/api/chat/delete" && req.method === "POST") {
      const { ch } = await channelFor(body.channel);
      const id = String(body.id || "");
      if (!ch || !/^\d{5,25}$/.test(id)) return send(res, 400, { error: "That message can't be deleted." }), true;
      const post = db.chatPosts[id];
      if (!(post && post.email === ctx.me) && !ctx.isAdmin) return send(res, 403, { error: "You can only delete your own messages." }), true;
      if (post && post.hook) {
        const r = await fetch(`${API}/webhooks/${post.hook}/messages/${id}`, { method: "DELETE" });
        if (!r.ok && r.status !== 404) throw Object.assign(new Error("webhook delete " + r.status), { status: r.status });
      } else await dc("DELETE", `/channels/${ch.id}/messages/${id}`);
      delete db.chatPosts[id]; ctx.save(); small.clear();
      return send(res, 200, { ok: true }), true;
    }

    if (url === "/api/chat/forward" && req.method === "POST") {
      if (limited("cf:" + ctx.me, 8, 60000)) return send(res, 429, { error: "You're doing that too fast." }), true;
      const { g, ch } = await channelFor(body.channel);
      const dest = visibleChannels(g).find((c) => c.id === String(body.to));
      if (!ch || !dest || !canPost(g, dest) || !/^\d{5,25}$/.test(String(body.id))) return send(res, 403, { error: "You can't forward there." }), true;
      if (!user || !user.name) return send(res, 400, { error: "Choose a chat name first." }), true;
      const m = await dc("GET", `/channels/${ch.id}/messages/${body.id}`);
      const text = cleanText(m.content, m, g) || "(attachment)";
      const sent = await dc("POST", `/channels/${dest.id}/messages`, { content: `**${user.name}** · via website\n↪ forwarded from #${ch.name} — **${m.author.global_name || m.author.username}**: ${text}`.slice(0, 1900), allowed_mentions: { parse: [] } });
      db.chatPosts[sent.id] = { channel: dest.id, email: ctx.me, name: user.name, hook: "" }; ctx.save();
      return send(res, 200, { ok: true }), true;
    }

    if (url === "/api/chat/media" && req.method === "GET") {
      let u; try { u = new URL(q.get("u") || ""); } catch (e) { return send(res, 400, { error: "Bad link." }), true; }
      if (u.protocol !== "https:" || !MEDIA_HOSTS.includes(u.hostname)) return send(res, 400, { error: "Not allowed." }), true;
      const r = await fetch(u.href);
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !/^(image|video)\//.test(type)) return send(res, 404, { error: "Not found." }), true;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) return send(res, 413, { error: "Too large." }), true;
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "private, max-age=3600", "Content-Length": buf.length });
      return res.end(buf), true;
    }
  } catch (e) { fail(e); return true; }
  send(res, 404, { error: "Not found." });
  return true;
}

module.exports = { handle };
