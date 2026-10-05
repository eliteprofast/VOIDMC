// Live chat bridge to Discord. Every Discord call happens here, with the bot token / OAuth secrets.
// The browser never talks to Discord, and nobody can chat without signing in with Discord.
const crypto = require("crypto");

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const GUILD_ID = process.env.DISCORD_GUILD_ID || "1545479832769536073";
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const API = (process.env.DISCORD_API || "https://discord.com/api/v10").replace(/\/+$/, "");
const AUTH_URL = process.env.DISCORD_AUTH_URL || "https://discord.com/oauth2/authorize";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const TRUST_PROXY = !!process.env.TRUST_PROXY;
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

// Discord's own permission algorithm. m = { id, roles } for a real member, or null for "@everyone only".
function permsFor(g, ch, userId, roleIds) {
  if (userId && g.guild.owner_id === userId) return ALL;
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
const botPerms = (g, ch) => permsFor(g, ch, g.botId, g.botMember.roles || []);

// Channels this member can view, using THEIR real Discord roles, and that the bot can read.
function visibleChannels(g, m) {
  return g.channels.filter((ch) => {
    if (!CHAT_TYPES.includes(ch.type)) return false;
    if (ONLY.length && !ONLY.includes(ch.id)) return false;
    return has(permsFor(g, ch, m.id, m.roles), BIT.VIEW) && has(botPerms(g, ch), BIT.VIEW | BIT.READ_HISTORY);
  });
}
const canPost = (g, ch, m) => has(permsFor(g, ch, m.id, m.roles), BIT.SEND) && has(botPerms(g, ch), BIT.SEND);
const isPrivate = (g, ch) => !has(permsFor(g, ch, null, []), BIT.VIEW);
async function channelFor(id, m) {
  const g = await guildData();
  return { g, ch: visibleChannels(g, m).find((c) => c.id === String(id)) };
}

// ---------- the signed-in member's Discord identity ----------
const linkOf = (user) => (user && user.discord && user.discord.id ? user.discord : null);
const displayName = (d) => d.nick || d.global_name || d.username;
const roleCache = new Map(); // discord id -> { at, roles }
async function memberOf(user, save) {
  const d = linkOf(user);
  if (!d) return null;
  const hit = roleCache.get(d.id);
  if (hit && Date.now() - hit.at < 60000) return { id: d.id, roles: hit.roles };
  let roles = d.roles || [];
  try {
    const mem = await dc("GET", `/guilds/${GUILD_ID}/members/${d.id}`);
    roles = mem.roles || [];
    if (mem.nick !== d.nick || JSON.stringify(roles) !== JSON.stringify(d.roles)) { d.nick = mem.nick || ""; d.roles = roles; save(); }
  } catch (e) {
    if (e.status === 404) return { id: d.id, roles: [], left: true };
  }
  roleCache.set(d.id, { at: Date.now(), roles });
  return { id: d.id, roles };
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
function badgesFor(g, roleIds) {
  const names = (roleIds || []).map((id) => (g.roles.find((x) => x.id === id) || {}).name || "");
  const out = [];
  if (names.some((n) => /owner|admin|mod|staff/i.test(n))) out.push("STAFF");
  if (names.some((n) => /dev|developer/i.test(n))) out.push("DEV");
  return out;
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
  const img = (v) => (v ? proxy(v.proxy_url || v.url) : "");
  return {
    color: e.color ? "#" + e.color.toString(16).padStart(6, "0") : "",
    author: e.author ? String(e.author.name || "").slice(0, 120) : "",
    title: String(e.title || "").slice(0, 200), url: /^https?:\/\//.test(e.url || "") ? e.url : "",
    description: String(e.description || "").slice(0, 1200),
    fields: (e.fields || []).slice(0, 8).map((f) => ({ name: String(f.name).slice(0, 100), value: String(f.value).slice(0, 300) })),
    image: img(e.image), thumbnail: img(e.thumbnail), footer: e.footer ? String(e.footer.text || "").slice(0, 120) : ""
  };
}
function shapeMessage(m, g, memberMap, ctx) {
  if (![0, 19, 20].includes(m.type)) return null; // hide joins, pins, boosts and other system entries
  const embeds = (m.embeds || []).slice(0, 6).map(shapeEmbed);
  const images = (m.attachments || []).filter((a) => /^image\//.test(a.content_type || "")).slice(0, 6).map((a) => proxy(a.proxy_url || a.url));
  let raw = m.content || "";
  const post = ctx.db.chatPosts[m.id];
  // messages sent by the bot on a member's behalf carry a "**Name**" first line; show them as that member
  if (post && raw.startsWith(`**${post.name}**\n`)) raw = raw.slice(post.name.length + 5);
  const content = cleanText(raw, m, g);
  if (!content && !embeds.length && !images.length) return null;
  let author;
  if (post) {
    author = { id: post.discordId, name: post.name, avatar: proxy(post.avatar), bot: false, color: post.color || "", badges: post.badges || [] };
  } else {
    const mem = memberMap[m.author.id];
    author = { id: m.author.id, name: (mem && mem.nick) || m.author.global_name || m.author.username, avatar: proxy(avatarUrl(m.author)), bot: !!m.author.bot || !!m.webhook_id, color: mem ? nameColor(g, mem.roles) : "", badges: mem ? badgesFor(g, mem.roles) : [] };
  }
  let reply = null;
  if (m.referenced_message) {
    const rm = m.referenced_message;
    const rp = ctx.db.chatPosts[rm.id];
    let rtext = rm.content || "(attachment)";
    if (rp && rtext.startsWith(`**${rp.name}**\n`)) rtext = rtext.slice(rp.name.length + 5);
    reply = { author: rp ? rp.name : rm.author ? rm.author.global_name || rm.author.username : "someone", text: cleanText(rtext, rm, g).slice(0, 120) };
  }
  return { id: m.id, ts: m.timestamp, content, images, embeds, reply, author, canDelete: !!(ctx.isAdmin || (post && post.email === ctx.me)) };
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

// ---------- webhooks (so a message appears as the member, not as a bot) ----------
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

// ---------- Discord OAuth ("Continue with Discord") ----------
const states = new Map(); // state -> { email, at }
function redirectUri(req) {
  if (PUBLIC_URL) return PUBLIC_URL + "/discord-callback";
  const proto = TRUST_PROXY ? String(req.headers["x-forwarded-proto"] || "https").split(",")[0] : "http";
  return `${proto}://${req.headers.host}/discord-callback`;
}
const oauthReady = () => !!(CLIENT_ID && CLIENT_SECRET);

// GET /discord-callback  (Discord sends the browser here)
async function callback(req, res, ctx) {
  const go = (to) => { res.writeHead(302, { Location: to }); res.end(); };
  const q = new URL(req.url, "http://x").searchParams;
  if (!ctx.me) return go("/login.html");
  const st = states.get(q.get("state") || "");
  states.delete(q.get("state") || "");
  if (q.get("error")) return go("/?chat=1&dc=denied");
  if (!st || st.email !== ctx.me || Date.now() - st.at > 600000 || !q.get("code")) return go("/?chat=1&dc=state");
  try {
    const tr = await fetch(API + "/oauth2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(req) })
    });
    const tok = await tr.json();
    if (!tr.ok || !tok.access_token) { console.log("[discord] token exchange failed:", tr.status, JSON.stringify(tok).slice(0, 200), "| redirect_uri was", redirectUri(req)); return go("/?chat=1&dc=error"); }
    const auth = { Authorization: "Bearer " + tok.access_token };
    const me = await (await fetch(API + "/users/@me", { headers: auth, signal: AbortSignal.timeout(8000) })).json();
    if (!me.id) return go("/?chat=1&dc=error");
    const mr = await fetch(`${API}/users/@me/guilds/${GUILD_ID}/member`, { headers: auth, signal: AbortSignal.timeout(8000) });
    if (!mr.ok) return go("/?chat=1&dc=notmember"); // not in the Discord server
    const mem = await mr.json();
    const taken = ctx.db.users.find((u) => u.discord && u.discord.id === me.id && u.email !== ctx.me);
    if (taken) return go("/?chat=1&dc=taken");
    const user = ctx.db.users.find((u) => u.email === ctx.me);
    user.discord = {
      id: me.id, username: me.username, global_name: me.global_name || "", nick: mem.nick || "",
      avatar_url: avatarUrl(me, 128), roles: mem.roles || [], linked_at: Date.now()
    };
    roleCache.delete(me.id);
    ctx.save();
    return go("/?chat=1");
  } catch (e) { console.log("[discord] sign-in failed:", e.message); return go("/?chat=1&dc=error"); }
}

// ---------- the route handler ----------
// Returns true when it handled the request. ctx: { me, isAdmin, send, body, db, save, limited, req, res }
async function handle(url, ctx) {
  const { req, res, send, body, db, limited } = ctx;
  const user = db.users.find((u) => u.email === ctx.me);

  // ----- Discord account link -----
  if (url === "/api/discord/status") {
    const d = linkOf(user);
    return send(res, 200, { configured: oauthReady() && !!TOKEN, linked: !!d, name: d ? displayName(d) : "", avatar: d ? proxy(d.avatar_url) : "", username: d ? d.username : "", redirect: ctx.isAdmin ? redirectUri(req) : undefined }), true;
  }
  if (url === "/api/discord/start") {
    if (!oauthReady()) return send(res, 503, { error: "Discord sign-in isn't set up yet." }), true;
    const state = crypto.randomBytes(16).toString("hex");
    states.set(state, { email: ctx.me, at: Date.now() });
    if (states.size > 500) states.delete(states.keys().next().value);
    const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code", scope: "identify guilds guilds.members.read", state, prompt: "none" });
    return send(res, 200, { url: AUTH_URL + "?" + p.toString() }), true;
  }
  if (url === "/api/discord/unlink" && req.method === "POST") {
    if (user) { delete user.discord; ctx.save(); }
    return send(res, 200, { ok: true }), true;
  }

  if (!url.startsWith("/api/chat/")) return false;
  if (!TOKEN) { send(res, 503, { error: "Chat isn't set up yet." }); return true; }
  const need = () => send(res, 403, { error: "Sign in with Discord to join the chat.", needLink: true });
  const mem = await memberOf(user, ctx.save).catch(() => null);
  if (!mem) { need(); return true; }
  if (mem.left) { send(res, 403, { error: "You're not in the Discord server any more. Join it to use the chat.", needLink: true }); return true; }
  const d = linkOf(user);
  const q = new URL(req.url, "http://x").searchParams;
  const fail = (e) => { console.log("[chat]", url, e.name === "TimeoutError" ? "timed out talking to Discord" : e.message, e.detail ? JSON.stringify(e.detail).slice(0, 200) : ""); return send(res, e.status === 429 ? 429 : 502, { error: friendly(e) }); };

  try {
    if (url === "/api/chat/channels" && req.method === "GET") {
      const g = await guildData();
      const vis = visibleChannels(g, mem);
      const cats = g.channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
      const staff = (n) => /staff|admin|mod/i.test(n);
      const groups = [];
      const row = (c) => ({ id: c.id, name: c.name, type: c.type, canPost: canPost(g, c, mem), private: isPrivate(g, c) });
      const mk = (name, list) => { if (list.length) groups.push({ name, channels: list.sort((a, b) => a.position - b.position).map(row) }); };
      cats.sort((a, b) => Number(staff(b.name)) - Number(staff(a.name))).forEach((cat) => mk(cat.name, vis.filter((c) => c.parent_id === cat.id)));
      mk("Channels", vis.filter((c) => !c.parent_id || !cats.some((x) => x.id === c.parent_id)));
      return send(res, 200, { groups, online: g.guild.approximate_presence_count || 0, total: g.guild.approximate_member_count || 0, me: { name: displayName(d), avatar: proxy(d.avatar_url) } }), true;
    }

    if (url === "/api/chat/messages" && req.method === "GET") {
      if (limited("cm:" + ctx.me, 150, 60000)) return send(res, 429, { error: "Slow down a little." }), true;
      const { g, ch } = await channelFor(q.get("channel"), mem);
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
      const list = (mc.list || []).slice(0, 300).map((m) => ({ id: m.user.id, name: m.nick || m.user.global_name || m.user.username, avatar: proxy(avatarUrl(m.user)), bot: !!m.user.bot, color: nameColor(g, m.roles), badges: badgesFor(g, m.roles) }));
      list.sort((a, b) => Number(a.bot) - Number(b.bot) || a.name.localeCompare(b.name));
      return send(res, 200, { online: g.guild.approximate_presence_count || 0, total: g.guild.approximate_member_count || 0, members: list, note: mc.error === "needs-intent" ? "The member list is hidden. Turn on 'Server Members Intent' for the bot in the Discord Developer Portal." : mc.error ? "The member list is unavailable right now." : "" }), true;
    }

    if (url === "/api/chat/send" && req.method === "POST") {
      if (limited("cs:" + ctx.me, 12, 60000) || limited("csf:" + ctx.me, 1, 1200)) return send(res, 429, { error: "You're sending too fast." }), true;
      const { g, ch } = await channelFor(body.channel, mem);
      if (!ch || !canPost(g, ch, mem)) return send(res, 403, { error: "You can't post in that channel." }), true;
      const text = String(body.text || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 1500);
      if (!text) return send(res, 400, { error: "Write a message first." }), true;
      const picked = (Array.isArray(body.mentions) ? body.mentions : []).filter((x) => /^\d{5,25}$/.test(String(x))).slice(0, 10).map(String);
      // only user mentions the sender picked are allowed to ping
      const content = text.replace(/<@&?!?\d+>/g, (t) => (/^<@!?(\d+)>$/.test(t) && picked.includes(t.replace(/\D/g, "")) ? t : "")).trim();
      const allowed = { parse: [], users: picked };
      const name = displayName(d), avatar = d.avatar_url;
      let sent, hook = null;
      if (body.replyTo && /^\d{5,25}$/.test(String(body.replyTo))) {
        // replies can only be carried by the bot; it prefixes the member's real Discord name
        sent = await dc("POST", `/channels/${ch.id}/messages`, { content: `**${name}**\n${content}`, allowed_mentions: Object.assign({ replied_user: false }, allowed), message_reference: { message_id: String(body.replyTo), channel_id: ch.id, fail_if_not_exists: false } });
      } else {
        hook = await webhookFor(ch.id);
        if (hook) {
          const r = await fetch(`${API}/webhooks/${hook.id}/${hook.token}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ content, username: name.replace(/discord|clyde/gi, "***").slice(0, 80) || "Member", avatar_url: avatar, allowed_mentions: allowed }) });
          if (!r.ok) throw Object.assign(new Error("webhook " + r.status), { status: r.status });
          sent = await r.json();
        } else sent = await dc("POST", `/channels/${ch.id}/messages`, { content: `**${name}**\n${content}`, allowed_mentions: allowed });
      }
      db.chatPosts[sent.id] = { channel: ch.id, email: ctx.me, discordId: d.id, name, avatar, color: nameColor(g, mem.roles), badges: badgesFor(g, mem.roles), hook: hook ? hook.id + "/" + hook.token : "" };
      const keys = Object.keys(db.chatPosts); if (keys.length > 3000) keys.slice(0, keys.length - 2000).forEach((k) => delete db.chatPosts[k]);
      ctx.save();
      small.clear();
      const shaped = { id: sent.id, ts: sent.timestamp, content: cleanText(content, sent, g), images: [], embeds: [], reply: null, author: { id: d.id, name, avatar: proxy(avatar), bot: false, color: nameColor(g, mem.roles), badges: badgesFor(g, mem.roles) }, canDelete: true };
      return send(res, 200, { message: shaped }), true;
    }

    if (url === "/api/chat/delete" && req.method === "POST") {
      const { ch } = await channelFor(body.channel, mem);
      const id = String(body.id || "");
      if (!ch || !/^\d{5,25}$/.test(id)) return send(res, 400, { error: "That message can't be deleted." }), true;
      const post = db.chatPosts[id];
      if (!(post && post.email === ctx.me) && !ctx.isAdmin) return send(res, 403, { error: "You can only delete your own messages." }), true;
      if (post && post.hook) {
        const r = await fetch(`${API}/webhooks/${post.hook}/messages/${id}`, { method: "DELETE", signal: AbortSignal.timeout(8000) });
        if (!r.ok && r.status !== 404) throw Object.assign(new Error("webhook delete " + r.status), { status: r.status });
      } else await dc("DELETE", `/channels/${ch.id}/messages/${id}`);
      delete db.chatPosts[id]; ctx.save(); small.clear();
      return send(res, 200, { ok: true }), true;
    }

    if (url === "/api/chat/forward" && req.method === "POST") {
      if (limited("cf:" + ctx.me, 8, 60000)) return send(res, 429, { error: "You're doing that too fast." }), true;
      const { g, ch } = await channelFor(body.channel, mem);
      const dest = visibleChannels(g, mem).find((c) => c.id === String(body.to));
      if (!ch || !dest || !canPost(g, dest, mem) || !/^\d{5,25}$/.test(String(body.id))) return send(res, 403, { error: "You can't forward there." }), true;
      const m = await dc("GET", `/channels/${ch.id}/messages/${body.id}`);
      const text = cleanText(m.content, m, g) || "(attachment)";
      const name = displayName(d);
      const sent = await dc("POST", `/channels/${dest.id}/messages`, { content: `**${name}**\n↪ forwarded from #${ch.name} — **${m.author.global_name || m.author.username}**: ${text}`.slice(0, 1900), allowed_mentions: { parse: [] } });
      db.chatPosts[sent.id] = { channel: dest.id, email: ctx.me, discordId: d.id, name, avatar: d.avatar_url, color: nameColor(g, mem.roles), badges: badgesFor(g, mem.roles), hook: "" }; ctx.save();
      return send(res, 200, { ok: true }), true;
    }

    if (url === "/api/chat/media" && req.method === "GET") {
      let u; try { u = new URL(q.get("u") || ""); } catch (e) { return send(res, 400, { error: "Bad link." }), true; }
      if (u.protocol !== "https:" || !MEDIA_HOSTS.includes(u.hostname)) return send(res, 400, { error: "Not allowed." }), true;
      const r = await fetch(u.href, { signal: AbortSignal.timeout(8000) });
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

module.exports = { handle, callback };
