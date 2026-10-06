// Optional outside storage (Upstash Redis, free tier) so data survives Render's free-plan restarts.
// Switched on by UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Without them nothing here does anything.
const URL_ = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const enabled = (/^https:\/\//.test(URL_) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(URL_)) && !!TOKEN; // plain http only for a test server on this computer
const MAX_IMAGE = 600 * 1024; // the free tier allows ~1 MB per request, and images are stored as base64

async function cmd(args) {
  const r = await fetch(URL_, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "redis " + r.status);
  return j.result;
}

// Reads the saved data. Returns the data, or null when nothing has been saved yet. Throws if it could not be read.
async function load() { const v = await cmd(["GET", "vsmp:db"]); return v ? JSON.parse(v) : null; }

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
  const j = dirty; dirty = null;
  inflight = cmd(["SET", "vsmp:db", j]).catch((e) => { console.log("[remote] save failed, will retry:", e.message); if (dirty == null) dirty = j; clearTimeout(timer); timer = setTimeout(push, 5000); })
    .finally(() => { inflight = null; if (dirty != null && !timer) timer = setTimeout(push, 1000); });
  return inflight;
}
async function flush() { clearTimeout(timer); timer = null; if (inflight) await inflight; if (dirty != null) await push(); if (inflight) await inflight; }

const imgKey = (name) => "vsmp:img:" + name;
const putImage = (name, buf) => cmd(["SET", imgKey(name), buf.toString("base64")]);
async function getImage(name) { const v = await cmd(["GET", imgKey(name)]); return v ? Buffer.from(v, "base64") : null; }
const delImage = (name) => cmd(["DEL", imgKey(name)]).catch(() => {});
async function hasImage(name) { try { return (await cmd(["EXISTS", imgKey(name)])) === 1; } catch (e) { return false; } }

module.exports = { enabled, MAX_IMAGE, load, save, flush, lockWrites, putImage, getImage, delImage, hasImage };
