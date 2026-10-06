// Optional outside storage so data survives Render's free-plan restarts. Pick ONE by setting its variables:
//   Supabase (free): SUPABASE_URL + SUPABASE_SERVICE_KEY  (+ optional SUPABASE_BUCKET, default "vsmp")
//   Upstash  (free): UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// Without any of them, nothing here does anything and the server uses its own disk.
const trim = (s) => String(s || "").trim().replace(/\/+$/, "");
const okUrl = (u) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u); // plain http only for a test server on this computer

const SB_URL = trim(process.env.SUPABASE_URL), SB_KEY = String(process.env.SUPABASE_SERVICE_KEY || "").trim(), SB_BUCKET = trim(process.env.SUPABASE_BUCKET) || "vsmp";
const UP_URL = trim(process.env.UPSTASH_REDIS_REST_URL), UP_TOKEN = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const useSupabase = okUrl(SB_URL) && !!SB_KEY;
const useUpstash = !useSupabase && okUrl(UP_URL) && !!UP_TOKEN;
const enabled = useSupabase || useUpstash;
const label = useSupabase ? "Supabase" : useUpstash ? "Upstash" : "";
const MAX_IMAGE = useSupabase ? 5 * 1024 * 1024 : 600 * 1024; // Upstash's free tier allows ~1 MB per request

// ---------------- backend: a tiny key/blob store ----------------
let backend;
if (useSupabase) {
  // Everything lives in one PRIVATE storage bucket: "db.json" for the data, "img/<name>" for pictures.
  const headers = (extra) => Object.assign({ apikey: SB_KEY }, SB_KEY.startsWith("eyJ") ? { Authorization: "Bearer " + SB_KEY } : {}, extra);
  const obj = (p) => `${SB_URL}/storage/v1/object/${SB_BUCKET}/${p}`;
  const notFound = (r, j) => r.status === 404 || (j && (String(j.statusCode) === "404" || j.error === "not_found"));
  backend = {
    async get(p) { // returns a Buffer, or null when it does not exist; throws on any other problem
      const r = await fetch(`${SB_URL}/storage/v1/object/authenticated/${SB_BUCKET}/${p}`, { headers: headers(), signal: AbortSignal.timeout(15000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      const j = await r.json().catch(() => ({}));
      if (notFound(r, j)) return null;
      throw new Error("supabase " + r.status + " " + (j.message || j.error || ""));
    },
    async put(p, buf, type) {
      const r = await fetch(obj(p), { method: "POST", headers: headers({ "x-upsert": "true", "Content-Type": type }), body: buf, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error("supabase " + r.status + " " + (j.message || j.error || "")); }
    },
    async del(p) { await fetch(`${SB_URL}/storage/v1/object/${SB_BUCKET}`, { method: "DELETE", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: [p] }), signal: AbortSignal.timeout(10000) }).catch(() => {}); }
  };
} else if (useUpstash) {
  const cmd = async (args) => {
    const r = await fetch(UP_URL, { method: "POST", headers: { Authorization: "Bearer " + UP_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || "redis " + r.status);
    return j.result;
  };
  backend = {
    async get(p) { const v = await cmd(["GET", "vsmp:" + p]); return v == null ? null : Buffer.from(v, "base64"); },
    async put(p, buf) { await cmd(["SET", "vsmp:" + p, buf.toString("base64")]); },
    async del(p) { await cmd(["DEL", "vsmp:" + p]).catch(() => {}); }
  };
}

// ---------------- the saved data ----------------
// Reads the saved data. Returns the data, or null when nothing has been saved yet. Throws if it could not be read.
async function load() { const b = await backend.get("db.json"); return b ? JSON.parse(b.toString("utf8")) : null; }

// Saving is delayed and combined, so a burst of changes is one write. If the first read failed we never write,
// so a bad connection can not overwrite good saved data with an empty copy.
let writable = true, timer = null, inflight = null, dirty = null;
function lockWrites() { writable = false; }
function save(json) {
  if (!enabled || !writable) return;
  dirty = json; clearTimeout(timer); timer = setTimeout(push, 800);
}
function push() {
  if (inflight || dirty == null) return inflight;
  const j = dirty; dirty = null; timer = null;
  inflight = backend.put("db.json", Buffer.from(j, "utf8"), "application/json").catch((e) => { console.log("[remote] save failed, will retry:", e.message); if (dirty == null) dirty = j; clearTimeout(timer); timer = setTimeout(push, 5000); })
    .finally(() => { inflight = null; if (dirty != null && !timer) timer = setTimeout(push, 1000); });
  return inflight;
}
async function flush() { clearTimeout(timer); timer = null; if (inflight) await inflight; if (dirty != null) await push(); if (inflight) await inflight; }

// ---------------- uploaded pictures ----------------
const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const imgPath = (name) => "img/" + name;
const putImage = (name, buf) => backend.put(imgPath(name), buf, IMG_TYPES[name.split(".").pop()] || "application/octet-stream");
const getImage = (name) => backend.get(imgPath(name));
const delImage = (name) => backend.del(imgPath(name));
async function hasImage(name) { try { return !!(await backend.get(imgPath(name))); } catch (e) { return false; } }

// A free Supabase project is paused after about a week without activity, so touch it twice a day.
if (useSupabase) setInterval(() => { backend.get("db.json").catch((e) => console.log("[remote] keep-alive failed:", e.message)); }, 12 * 3600 * 1000).unref();

module.exports = { enabled, label, MAX_IMAGE, load, save, flush, lockWrites, putImage, getImage, delImage, hasImage };
