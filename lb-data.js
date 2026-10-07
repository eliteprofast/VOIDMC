// Leaderboard data: players with a few stats, a small history for the chart, and the totals shown on the page.
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const MAX_PLAYERS = 200, MAX_HISTORY = 48, SNAPSHOT_MS = 3600000;

const num = (v, max, int) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(String(v).replace(/[,\s$€]/g, ""));
  if (!isFinite(n) || n < 0) return null;
  const c = Math.min(n, max);
  return int ? Math.floor(c) : Math.round(c * 100) / 100;
};
const word = (v, n) => (v === undefined ? undefined : String(v).replace(/[^\w +\-.]/g, "").trim().slice(0, n));

// Cleans one incoming row. Returns { row } with only the fields that were given, or { error }.
function cleanRow(r) {
  if (!r || typeof r !== "object") return { error: "not an object" };
  const name = String(r.name || "").trim();
  if (!NAME_RE.test(name)) return { error: "bad name" };
  const row = { name };
  const fields = { balance: num(r.balance, 1e15), kills: num(r.kills, 1e9, true), deaths: num(r.deaths, 1e9, true), playtime: num(r.playtime, 1e6) };
  for (const k of Object.keys(fields)) { if (fields[k] === null) return { error: "bad " + k }; if (fields[k] !== undefined) row[k] = fields[k]; }
  const clan = word(r.clan, 16); if (clan !== undefined) row.clan = clan;
  return { row };
}

function board(db) { return db.leaderboard || (db.leaderboard = { players: [], updatedAt: 0 }); }

// Adds or updates players. Returns { updated, rejected: [names or reasons] }.
function upsert(db, rows, now) {
  const b = board(db);
  let updated = 0; const rejected = [];
  for (const raw of (Array.isArray(rows) ? rows : []).slice(0, 150)) {
    const c = cleanRow(raw);
    if (c.error) { rejected.push((raw && raw.name ? String(raw.name).slice(0, 16) : "?") + ": " + c.error); continue; }
    let p = b.players.find((x) => x.name.toLowerCase() === c.row.name.toLowerCase());
    if (!p) { if (b.players.length >= MAX_PLAYERS) { rejected.push(c.row.name + ": list is full"); continue; } p = { name: c.row.name, clan: "", balance: 0, kills: 0, deaths: 0, playtime: 0, h: [] }; b.players.push(p); }
    Object.assign(p, c.row, { name: c.row.name });
    p.updated = now;
    const last = p.h[p.h.length - 1];
    if (!last || now - last[0] >= SNAPSHOT_MS) { p.h.push([now, p.balance, p.kills]); if (p.h.length > MAX_HISTORY) p.h.shift(); }
    updated++;
  }
  if (updated) b.updatedAt = now;
  return { updated, rejected };
}
function remove(db, name) { const b = board(db), n = b.players.length; b.players = b.players.filter((p) => p.name.toLowerCase() !== String(name).toLowerCase()); return n - b.players.length; }

const kdOf = (p) => (p.deaths ? p.kills / p.deaths : p.kills);
// % change of the balance compared with about 24 hours ago (null when there is no history yet)
function change24(p, now) {
  if (!p.h || p.h.length < 2) return null;
  const target = now - 86400000;
  let ref = p.h[0];
  for (const s of p.h) { if (s[0] <= target) ref = s; else break; }
  if (ref === p.h[p.h.length - 1] || !ref[1]) return null;
  return Math.round(((p.balance - ref[1]) / ref[1]) * 10000) / 100;
}
const view = (p, rank, now) => ({ rank, name: p.name, clan: p.clan || "", balance: p.balance, kills: p.kills, deaths: p.deaths, kd: Math.round(kdOf(p) * 100) / 100, playtime: p.playtime, change24: change24(p, now), updated: p.updated || 0 });

const SORTS = { balance: (a, b) => b.balance - a.balance, kills: (a, b) => b.kills - a.kills, kd: (a, b) => kdOf(b) - kdOf(a) || b.kills - a.kills, playtime: (a, b) => b.playtime - a.playtime };

function list(db, { sort, q, limit, offset }, now) {
  const b = board(db);
  const ranked = b.players.slice().sort(SORTS[sort] || SORTS.balance).map((p, i) => view(p, i + 1, now));
  const needle = String(q || "").toLowerCase().slice(0, 32);
  const hits = needle ? ranked.filter((p) => p.name.toLowerCase().includes(needle) || p.clan.toLowerCase().includes(needle)) : ranked;
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 20)), off = Math.max(0, parseInt(offset, 10) || 0);
  const tot = b.players.reduce((a, p) => ({ balance: a.balance + p.balance, kills: a.kills + p.kills, deaths: a.deaths + p.deaths, playtime: a.playtime + p.playtime }), { balance: 0, kills: 0, deaths: 0, playtime: 0 });
  const clans = {};
  b.players.forEach((p) => { if (p.clan) { const c = clans[p.clan.toLowerCase()] || (clans[p.clan.toLowerCase()] = { clan: p.clan, kills: 0, members: 0, balance: 0 }); c.kills += p.kills; c.members++; c.balance += p.balance; } });
  return {
    players: hits.slice(off, off + lim), matches: hits.length, count: b.players.length, updatedAt: b.updatedAt,
    totals: { balance: tot.balance, kills: tot.kills, deaths: tot.deaths, playtime: Math.round(tot.playtime), avgKd: tot.deaths ? Math.round((tot.kills / tot.deaths) * 100) / 100 : tot.kills },
    clans: Object.values(clans).sort((a, c) => c.kills - a.kills).slice(0, 5)
  };
}
function one(db, name, now) {
  const b = board(db), lname = String(name).toLowerCase();
  const sorted = b.players.slice().sort(SORTS.balance);
  const i = sorted.findIndex((p) => p.name.toLowerCase() === lname);
  if (i < 0) return null;
  return Object.assign(view(sorted[i], i + 1, now), { history: sorted[i].h || [] });
}

module.exports = { upsert, remove, list, one, board, cleanRow, MAX_PLAYERS };
