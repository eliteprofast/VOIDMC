// VSMP site server: static files + a small JSON-file "database" and API. No dependencies. Run: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const vm = require("vm");

// ---------- .env ----------
try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
} catch (e) {}
const chat = require("./chat-server");
const mc = require("./mcstatus"); // after .env is loaded, because it reads the bot token
const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "ali.eliteprofast@gmail.com").trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || ""; // password of the owner account
const STAFF_WEBHOOK = process.env.DISCORD_STAFF_WEBHOOK_URL || "";
const TRUST_PROXY = !!process.env.TRUST_PROXY;

const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png" };
const SAFE = ["index.html", "login.html", "vote.html", "apply.html", "admin.html", "style.css", "config.js", "bg.js", "main.js", "ui.js", "auth.js", "chat.js", "chatmd.js", "chat.html", "reveal.js", "gallery.js", "store.js", "apply.js", "admin.js", "sanctuary.jpg"];
const PUBLIC_FILES = ["login.html", "style.css", "config.js", "bg.js", "ui.js", "auth.js", "sanctuary.jpg"]; // everything else needs a login

// ---------- database (data.json) ----------
// DATA_DIR lets a host keep the data on a persistent disk (e.g. /var/data on Render). Defaults to this folder.
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const DB_FILE = path.join(DATA_DIR, "data.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
const UPLOAD_RE = /^uploads\/[a-f0-9]{16,32}\.(png|jpg|gif|webp)$/;
const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
// real image files start with these bytes. We trust the bytes, never the file name or the type the browser claims.
function sniffImage(b) {
  if (b.length > 12 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG") return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6))) return "gif";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return "";
}
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (c) => { n += c.length; if (n <= max) chunks.push(c); });
    req.on("end", () => (n > max ? reject(new Error("too big")) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
const DEFAULT_QUESTIONS = [
  { id: "q1", step: "About you", step_order: 1, label: "How old are you?", hint: "", type: "text", options: [], required: true, sort: 1 },
  { id: "q2", step: "About you", step_order: 1, label: "What is your timezone?", hint: "e.g. GMT+5", type: "text", options: [], required: true, sort: 2 },
  { id: "q3", step: "Experience", step_order: 2, label: "Tell us about your moderation experience", hint: "Servers, roles, how long", type: "paragraph", options: [], required: true, sort: 3 },
  { id: "q4", step: "Experience", step_order: 2, label: "Why do you want to join the staff team?", hint: "", type: "paragraph", options: [], required: true, sort: 4 },
  { id: "q5", step: "Availability", step_order: 3, label: "How many hours a day can you be online?", hint: "", type: "select", options: ["1-2 hours", "3-5 hours", "6+ hours"], required: true, sort: 5 },
  { id: "q6", step: "Availability", step_order: 3, label: "I have read and understood the server rules", hint: "", type: "checkbox", options: [], required: true, sort: 6 },
  { id: "q7", step: "Availability", step_order: 3, label: "Link to a screenshot (optional)", hint: "Upload to imgur or similar and paste the link", type: "screenshot", options: [], required: false, sort: 7 }
];
let db = { nextId: 1, gallery: [], applications: [], orders: [], announcement: null, questions: DEFAULT_QUESTIONS, users: [], admins: [], sessions: {}, chatPosts: {}, reactions: {}, adminPerms: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, "utf8"))); } catch (e) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db, null, 1), () => {}), 200);
}
const newId = () => db.nextId++;

// ---------- helpers ----------
function loadConfig() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "config.js"), "utf8"), ctx);
  return ctx.window.VSMP;
}
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, n);
const cleanLine = (s, n) => clean(s, n).replace(/[\r\n]+/g, " ");
const ipOf = (req) => (TRUST_PROXY && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress);
function httpUrl(u) {
  try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href.slice(0, 500) : ""; } catch (e) { return ""; }
}
function youtubeId(u) {
  const m = String(u).match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : "";
}
const buckets = new Map();
function limited(key, max, ms) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < ms);
  if (list.length >= max) { buckets.set(key, list); return true; }
  list.push(now); buckets.set(key, list);
  return false;
}
function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 30000) { reject(new Error("too big")); req.destroy(); } });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// Staff notifications to a Discord webhook (optional). Falls back to curl if Node can't verify the certificate.
async function notify(text) {
  if (!STAFF_WEBHOOK) return;
  const body = JSON.stringify({ content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } });
  try {
    const r = await fetch(STAFF_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (!r.ok) console.log("[notify] webhook said", r.status);
  } catch (e) {
    await new Promise((resolve) => {
      const c = require("child_process").spawn("curl", ["-s", "-S", "-o", process.platform === "win32" ? "NUL" : "/dev/null", "-X", "POST", "-H", "Content-Type: application/json", "--data-binary", "@-", STAFF_WEBHOOK]);
      c.on("error", () => resolve());
      c.on("close", resolve);
      c.stdin.end(body);
    });
  }
}

// ---------- accounts ----------
const EMAIL_RE = /^[^@\s,;<>"]{1,64}@[^@\s,;<>"]{1,120}\.[^@\s,;<>"]{2,}$/;
const SESSION_MS = 365 * 24 * 3600 * 1000; // stay logged in for a year on a device
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString("hex") + ":" + crypto.scryptSync(String(pw), salt, 64).toString("hex");
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(String(pw), Buffer.from(salt, "hex"), 64), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookieOf(req, name) {
  const m = String(req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
function sessionOf(req) {
  const s = db.sessions[cookieOf(req, "vsmp_s")];
  if (!s) return null;
  if (Date.now() - s.created > SESSION_MS) { delete db.sessions[cookieOf(req, "vsmp_s")]; return null; }
  return s.email;
}
function startSession(res, email) {
  const t = crypto.randomBytes(32).toString("hex");
  db.sessions[t] = { email, created: Date.now() };
  save();
  res.setHeader("Set-Cookie", `vsmp_s=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${TRUST_PROXY ? "; Secure" : ""}`);
}
function endSessions(email) { for (const t of Object.keys(db.sessions)) if (db.sessions[t].email === email) delete db.sessions[t]; save(); }
const isAdminEmail = (e) => !!e && (e === OWNER_EMAIL || db.admins.includes(e));
// what each admin may manage. The owner can do everything; admins added before this existed keep full access.
const ALL_PERMS = ["gallery", "applications", "orders", "announcement", "questions", "chat"];
const permsOf = (e) => (e === OWNER_EMAIL ? ALL_PERMS.slice() : db.admins.includes(e) ? (db.adminPerms[e] || ALL_PERMS.slice()) : []);
const can = (e, p) => permsOf(e).includes(p);
const cleanPerms = (p) => ALL_PERMS.filter((x) => Array.isArray(p) && p.includes(x));

let mcCache = { at: 0, data: null };
const publicGallery = (g) => ({ id: g.id, title: g.title, kind: g.kind, url: g.url, thumb: g.thumb, player: g.player, caption: g.caption, votes: g.voters.length });

// ---------- API ----------
async function api(req, res, url) {
  const method = req.method;
  const ip = ipOf(req);

  if (url === "/api/upload" && method === "POST") {
    const who = sessionOf(req);
    if (!who) return send(res, 401, { error: "Please log in." });
    if (limited("up:" + who, 8, 3600000)) return send(res, 429, { error: "You've uploaded a few already. Please try again later." });
    let buf;
    try { buf = await readRaw(req, 5 * 1024 * 1024); } catch (e) { return send(res, 413, { error: "That image is too big. The limit is 5 MB." }); }
    const ext = sniffImage(buf);
    if (!ext) return send(res, 400, { error: "That file isn't a PNG, JPG, GIF or WebP image." });
    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return send(res, 200, { path: "uploads/" + name });
  }

  let body = {};
  if (method === "POST") {
    try { body = await readJson(req); } catch (e) { return send(res, 400, { error: "Something was wrong with that request." }); }
  }

  // ----- auth (the only routes that don't need a login) -----
  if (url === "/api/auth/logout") {
    // the Discord link belongs to the VSMP account (email), so logging out does NOT remove it
    delete db.sessions[cookieOf(req, "vsmp_s")]; save();
    res.setHeader("Set-Cookie", "vsmp_s=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    return send(res, 200, { ok: true });
  }
  if (url.startsWith("/api/auth/") && method === "POST") {
    const email = cleanLine(body.email, 130).toLowerCase();
    const password = String(body.password || "").slice(0, 200);
    const bad = (msg, code) => send(res, code || 400, { error: msg });
    if (!EMAIL_RE.test(email)) return bad("That email doesn't look right.");
    if (url === "/api/auth/register") {
      if (limited("reg:" + ip, 8, 3600000)) return bad("Too many tries. Please wait a while.", 429);
      if (isAdminEmail(email)) return bad("That email is reserved for staff. Please use a different one.");
      if (db.users.some((u) => u.email === email)) return bad("That email already has an account. Please log in.");
      if (password.length < 8) return bad("Choose a password with at least 8 characters.");
      db.users.push({ email, hash: hashPassword(password), created: Date.now() });
      startSession(res, email);
      return send(res, 200, { ok: true });
    }
    if (url === "/api/auth/login") {
      if (limited("login:" + ip, 12, 900000) || limited("loginm:" + email, 8, 900000)) return bad("Too many tries. Wait 15 minutes.", 429);
      const u = db.users.find((x) => x.email === email);
      if (!u || !checkPassword(password, u.hash)) return bad("Wrong email or password.", 401);
      startSession(res, email);
      return send(res, 200, { ok: true });
    }
    return bad("Unknown action.", 404);
  }
  // everything below needs a logged-in member
  const me = sessionOf(req);
  if (!me) return send(res, 401, { error: "Please log in." });
  if (url === "/api/me") { const u = db.users.find((x) => x.email === me); return send(res, 200, { email: me, name: (u && u.name) || "", admin: permsOf(me).length > 0, perms: permsOf(me), owner: me === OWNER_EMAIL }); }
  if (url.startsWith("/api/chat/") || url.startsWith("/api/discord/")) { if (await chat.handle(url, { req, res, send, body, db, save, limited, me, isAdmin: can(me, "chat") })) return; } // admins with the "chat" permission can delete anyone's messages

  // Minecraft server status, asked directly by this server and shared by everyone for a few seconds
  if (url === "/api/mc-status" && method === "GET") {
    const now = Date.now();
    if (!mcCache.data || now - mcCache.at > 15000) {
      const addr = String(process.env.MC_ADDRESS || loadConfig().serverIp || "").trim(); // MC_ADDRESS can override config.js
      const m = addr.match(/^(.+?)(?::(\d{1,5}))?$/);
      let r = m ? await mc.ping(m[1], Number(m[2]) || 25565, 5000) : { online: false, reason: "no-address" };
      if (!r.online) { // a second opinion from a public service, in case this host can't reach the server
        try {
          const d = await (await fetch("https://api.mcstatus.io/v2/status/java/" + encodeURIComponent(addr), { signal: AbortSignal.timeout(6000) })).json();
          if (d.online) r = { online: true, now: d.players.online, max: d.players.max, version: d.version && d.version.name_clean, motd: "", ms: null, via: "mcstatus.io" };
        } catch (e) {}
      }
      mcCache = { at: now, data: Object.assign({ address: addr }, r) };
    }
    return send(res, 200, mcCache.data);
  }

  // public reads
  if (url === "/api/announcement" && method === "GET") return send(res, 200, db.announcement && db.announcement.active && db.announcement.message ? db.announcement : {});
  if (url === "/api/gallery" && method === "GET") return send(res, 200, db.gallery.filter((g) => g.status === "approved").sort((a, b) => b.id - a.id).map(publicGallery));
  if (url === "/api/apply/questions" && method === "GET") return send(res, 200, db.questions.slice().sort((a, b) => a.step_order - b.step_order || a.sort - b.sort));

  // gallery submit + vote
  if (url === "/api/gallery" && method === "POST") {
    const title = cleanLine(body.title, 80), player = cleanLine(body.player, 32), caption = clean(body.caption, 300);
    const image = typeof body.image === "string" && UPLOAD_RE.test(body.image) && fs.existsSync(path.join(UPLOAD_DIR, path.basename(body.image))) ? body.image : "";
    const videoRaw = cleanLine(body.video, 500);
    const yt = videoRaw ? youtubeId(httpUrl(videoRaw)) : "";
    if (!title || !player) return send(res, 400, { error: "Please add a moment name and your in-game name." });
    if (videoRaw && !yt) return send(res, 400, { error: "Please paste a YouTube link (youtube.com or youtu.be)." });
    if (!image && !yt) return send(res, 400, { error: "Please upload an image or paste a video link." });
    if (limited("gal:" + ip, 6, 3600000)) return send(res, 429, { error: "You've sent a few already. Please try again later." });
    const item = { id: newId(), title, player, caption, status: "pending", voters: [], created: Date.now() };
    if (yt) { item.kind = "youtube"; item.url = yt; item.thumb = image || "https://i.ytimg.com/vi/" + yt + "/hqdefault.jpg"; }
    else { item.kind = "image"; item.url = image; item.thumb = image; }
    if (image) item.file = image;
    db.gallery.push(item); save();
    notify("🖼️ New gallery submission waiting for review: **" + title + "** by " + player);
    return send(res, 200, { ok: true });
  }
  if (url === "/api/gallery/vote" && method === "POST") {
    const g = db.gallery.find((x) => x.id === Number(body.id) && x.status === "approved");
    const client = cleanLine(body.client, 64);
    if (!g || !client) return send(res, 400, { error: "That item can't be voted on." });
    if (limited("vote:" + ip, 30, 600000)) return send(res, 429, { error: "Slow down a little." });
    const i = g.voters.indexOf(client);
    if (i >= 0) g.voters.splice(i, 1); else g.voters.push(client);
    save();
    return send(res, 200, { votes: g.voters.length, voted: i < 0 });
  }

  // staff application
  if (url === "/api/apply" && method === "POST") {
    if (limited("app:" + ip, 3, 3600000)) return send(res, 429, { error: "You've already applied recently. Please wait a bit." });
    const name = cleanLine(body.name, 60), discord = cleanLine(body.discord, 40), minecraft = cleanLine(body.minecraft, 20);
    if (!name || !discord || !minecraft) return send(res, 400, { error: "Please fill in your name, Discord and Minecraft username." });
    const answers = [];
    for (const q of db.questions) {
      const a = (Array.isArray(body.answers) ? body.answers : []).find((x) => x && x.id === q.id);
      let v = a ? (q.type === "checkbox" ? (a.value ? "Yes" : "") : q.type === "screenshot" ? httpUrl(a.value) : clean(a.value, 1500)) : "";
      if (q.type === "select" && v && !q.options.includes(v)) v = "";
      if (q.required && !v) return send(res, 400, { error: "Please answer: " + q.label });
      answers.push({ question: q.label, answer: v });
    }
    db.applications.push({ id: newId(), name, discord, minecraft, answers, status: "pending", note: "", created: Date.now() }); save();
    notify("📝 New staff application from **" + name + "** (" + minecraft + " / " + discord + ")");
    return send(res, 200, { ok: true });
  }

  // order
  if (url === "/api/order" && method === "POST") {
    if (limited("ord:" + ip, 5, 3600000)) return send(res, 429, { error: "Too many orders from here. Please try again later." });
    const username = cleanLine(body.username, 20), email = me; // the order is tied to the logged-in account
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) return send(res, 400, { error: "Enter your Minecraft username (letters, numbers, underscore)." });
    const cfg = loadConfig();
    const catalogue = [].concat(cfg.ranks || [], cfg.items || []);
    const items = [];
    let total = 0;
    for (const line of Array.isArray(body.items) ? body.items.slice(0, 20) : []) {
      const p = catalogue.find((c) => c.id === line.id);
      const qty = Math.max(1, Math.min(10, parseInt(line.qty, 10) || 1));
      if (!p) continue;
      items.push({ id: p.id, name: p.name, price: p.price, qty });
      total += p.price * qty;
    }
    if (!items.length) return send(res, 400, { error: "Your cart is empty." });
    const order = { id: newId(), username, email, items, total: Math.round(total * 100) / 100, status: "pending", created: Date.now() };
    db.orders.push(order); save();
    notify("🛒 New order #" + order.id + " from **" + username + "**: " + items.map((i) => i.qty + "x " + i.name).join(", ") + " — $" + order.total.toFixed(2));
    return send(res, 200, { ok: true, id: order.id, total: order.total });
  }

  // admin
  if (url.startsWith("/api/admin/")) {
    if (!isAdminEmail(me) || !permsOf(me).length) return send(res, 403, { error: "Only admins can do that." });
    const DENIED = { error: "You don't have permission to do that." };
    if (url === "/api/admin/admins") { // owner only: add / remove admin emails
      if (me !== OWNER_EMAIL) return send(res, 403, { error: "Only the owner can manage admins." });
      if (method === "POST") {
        const e = cleanLine(body.email, 130).toLowerCase();
        if (!EMAIL_RE.test(e)) return send(res, 400, { error: "That email doesn't look right." });
        if (e === OWNER_EMAIL) return send(res, 400, { error: "The owner is always an admin." });
        if (body.action === "add") {
          // The owner sets the admin's password, so nobody can claim an admin email by registering it.
          const pw = String(body.password || "").slice(0, 200);
          if (pw.length < 8) return send(res, 400, { error: "Give them a password of at least 8 characters." });
          const u = db.users.find((x) => x.email === e);
          if (u) { u.hash = hashPassword(pw); endSessions(e); } else db.users.push({ email: e, hash: hashPassword(pw), created: Date.now() });
          if (!db.admins.includes(e)) db.admins.push(e);
          db.adminPerms[e] = cleanPerms(body.permissions);
        } else if (body.action === "perms") {
          if (!db.admins.includes(e)) return send(res, 404, { error: "That person isn't an admin." });
          db.adminPerms[e] = cleanPerms(body.permissions);
        } else if (body.action === "remove") { db.admins = db.admins.filter((x) => x !== e); delete db.adminPerms[e]; endSessions(e); }
        save();
      }
      return send(res, 200, { owner: OWNER_EMAIL, allPerms: ALL_PERMS, admins: db.admins.map((e) => ({ email: e, perms: permsOf(e) })) });
    }
    if (url === "/api/admin/data" && method === "GET")
      return send(res, 200, { me, owner: me === OWNER_EMAIL, perms: permsOf(me),
        gallery: can(me, "gallery") ? db.gallery.map((g) => Object.assign(publicGallery(g), { status: g.status })) : [],
        applications: can(me, "applications") ? db.applications : [], orders: can(me, "orders") ? db.orders : [],
        announcement: can(me, "announcement") ? db.announcement : null, questions: can(me, "questions") ? db.questions : [] });
    if (url === "/api/admin/gallery" && method === "POST") {
      if (!can(me, "gallery")) return send(res, 403, DENIED);
      const i = db.gallery.findIndex((g) => g.id === Number(body.id));
      if (i < 0) return send(res, 404, { error: "Not found." });
      if (body.action === "approve") db.gallery[i].status = "approved";
      else if (body.action === "unapprove") db.gallery[i].status = "pending";
      else if (body.action === "delete") { const gone = db.gallery.splice(i, 1)[0]; if (gone && gone.file && UPLOAD_RE.test(gone.file) && !db.gallery.some((x) => x.file === gone.file)) fs.unlink(path.join(UPLOAD_DIR, path.basename(gone.file)), () => {}); }
      save(); return send(res, 200, { ok: true });
    }
    if (url === "/api/admin/application" && method === "POST") {
      if (!can(me, "applications")) return send(res, 403, DENIED);
      const a = db.applications.find((x) => x.id === Number(body.id));
      if (!a) return send(res, 404, { error: "Not found." });
      if (["pending", "shortlisted", "accepted", "declined"].includes(body.status)) a.status = body.status;
      if (typeof body.note === "string") a.note = clean(body.note, 1000);
      if (body.delete) db.applications = db.applications.filter((x) => x !== a);
      save(); return send(res, 200, { ok: true });
    }
    if (url === "/api/admin/order" && method === "POST") {
      if (!can(me, "orders")) return send(res, 403, DENIED);
      const o = db.orders.find((x) => x.id === Number(body.id));
      if (!o) return send(res, 404, { error: "Not found." });
      if (["pending", "paid", "delivered"].includes(body.status)) o.status = body.status;
      if (body.delete) db.orders = db.orders.filter((x) => x !== o);
      save(); return send(res, 200, { ok: true });
    }
    if (url === "/api/admin/announcement" && method === "POST") {
      if (!can(me, "announcement")) return send(res, 403, DENIED);
      db.announcement = { message: cleanLine(body.message, 200), tag: cleanLine(body.tag, 20), link_url: httpUrl(body.link_url), link_label: cleanLine(body.link_label, 20), active: !!body.active };
      save(); return send(res, 200, { ok: true });
    }
    if (url === "/api/admin/questions" && method === "POST") {
      if (!can(me, "questions")) return send(res, 403, DENIED);
      const TYPES_OK = ["text", "paragraph", "select", "checkbox", "screenshot"];
      const qs = (Array.isArray(body.questions) ? body.questions : []).slice(0, 40).map((q, i) => ({
        id: cleanLine(q.id, 20) || "q" + newId(), step: cleanLine(q.step, 40) || "Questions", step_order: Number(q.step_order) || 1,
        label: cleanLine(q.label, 160), hint: cleanLine(q.hint, 160), type: TYPES_OK.includes(q.type) ? q.type : "text",
        options: (Array.isArray(q.options) ? q.options : []).map((o) => cleanLine(o, 60)).filter(Boolean).slice(0, 12), required: !!q.required, sort: i + 1
      })).filter((q) => q.label);
      db.questions = qs; save(); return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Unknown action." });
  }
  return send(res, 404, { error: "Not found." });
}

// ---------- server ----------
http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url.startsWith("/api/")) return api(req, res, url).catch((e) => { console.log("[api]", e.message); send(res, 500, { error: "Something went wrong on our side. Please try again." }); });
  if (url.startsWith("/uploads/")) {
    const name = url.slice(9);
    if (!sessionOf(req)) { res.writeHead(401); return res.end("Please log in"); }
    if (!UPLOAD_RE.test("uploads/" + name)) { res.writeHead(404); return res.end("Not found"); }
    return fs.readFile(path.join(UPLOAD_DIR, name), (err, buf) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": IMG_TYPES[name.split(".").pop()], "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" });
      res.end(buf);
    });
  }
  if (url === "/discord-callback") return chat.callback(req, res, { db, save, me: sessionOf(req) });
  const file = path.join(__dirname, url === "/" ? "index.html" : url);
  const base = path.basename(file);
  if (!SAFE.includes(base) || path.dirname(file) !== __dirname) { res.writeHead(404); return res.end("Not found"); }
  // the whole site (except the login page and its assets) is for logged-in members only
  if (!PUBLIC_FILES.includes(base)) {
    const who = sessionOf(req);
    const page = base.endsWith(".html");
    if (!who) {
      if (page) { res.writeHead(302, { Location: "/login.html" }); return res.end(); }
      res.writeHead(401); return res.end("Please log in");
    }
    if (base === "admin.html" && !(isAdminEmail(who) && permsOf(who).length)) { res.writeHead(302, { Location: "/" }); return res.end(); }
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`VSMP site on http://localhost:${PORT}` + "\nOwner account: " + OWNER_EMAIL + (OWNER_PASSWORD.length >= 8 ? "" : "  (NOT SET UP: add OWNER_PASSWORD=<8+ characters> to .env and restart)")));

// The owner account always exists and uses OWNER_PASSWORD from .env (nobody can register that email).
if (OWNER_PASSWORD.length >= 8) {
  const u = db.users.find((x) => x.email === OWNER_EMAIL);
  if (!u) db.users.push({ email: OWNER_EMAIL, hash: hashPassword(OWNER_PASSWORD), created: Date.now() });
  else if (!checkPassword(OWNER_PASSWORD, u.hash)) { u.hash = hashPassword(OWNER_PASSWORD); endSessions(OWNER_EMAIL); }
  save();
}
