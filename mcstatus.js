// Asks a Minecraft Java server directly, using the same "server list ping" the game itself uses. No third-party service.
const net = require("net");

function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}
const packet = (body) => Buffer.concat([varint(body.length), body]);
const mcString = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([varint(b.length), b]); };

// reads a varint from buf at offset; returns [value, newOffset] or null when more bytes are needed
function readVarint(buf, off) {
  let n = 0, shift = 0;
  for (let i = 0; i < 5; i++) {
    if (off + i >= buf.length) return null;
    const b = buf[off + i];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [n, off + i + 1];
    shift += 7;
  }
  throw new Error("bad varint");
}

function motdText(d) {
  if (!d) return "";
  if (typeof d === "string") return d;
  return (d.text || "") + (Array.isArray(d.extra) ? d.extra.map(motdText).join("") : "");
}

// resolves { online: true, now, max, version, motd, ms } or { online: false, reason }
function ping(host, port, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false, buf = Buffer.alloc(0);
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(r); };
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => finish({ online: false, reason: "timeout" }), timeoutMs);
    sock.on("connect", () => {
      const handshake = Buffer.concat([varint(0), varint(767), mcString(host), Buffer.from([port >> 8, port & 255]), varint(1)]);
      sock.write(Buffer.concat([packet(handshake), packet(varint(0))]));
    });
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len[1] + len[0]) return; // wait for the rest
        const id = readVarint(buf, len[1]);
        const slen = readVarint(buf, id[1]);
        if (!slen || buf.length < slen[1] + slen[0]) return;
        const json = JSON.parse(buf.slice(slen[1], slen[1] + slen[0]).toString("utf8"));
        finish({
          online: true,
          now: json.players ? json.players.online : 0,
          max: json.players ? json.players.max : 0,
          version: json.version ? String(json.version.name || "").replace(/§./g, "") : "",
          motd: motdText(json.description).replace(/§./g, "").slice(0, 120),
          ms: Date.now() - t0
        });
      } catch (e) { if (buf.length > 200000) finish({ online: false, reason: "bad-reply" }); }
    });
    sock.on("error", (e) => finish({ online: false, reason: e.code || "error" }));
    sock.on("close", () => finish({ online: false, reason: "closed" }));
  });
}

module.exports = { ping };
