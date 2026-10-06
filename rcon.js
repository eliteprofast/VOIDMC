// Minecraft RCON client (the standard remote-console protocol). Sends ONE command and returns the server's reply.
const net = require("net");

function packet(id, type, body) {
  const b = Buffer.from(body, "utf8");
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8); b.copy(buf, 12);
  return buf;
}

// resolves { ok: true, text } or { ok: false, reason }
function run(host, port, password, command, timeoutMs) {
  timeoutMs = timeoutMs || 6000;
  return new Promise((resolve) => {
    let buf = Buffer.alloc(0), authed = false, done = false, text = "", idle = null;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(idle); sock.destroy(); resolve(r); };
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => finish({ ok: false, reason: "The Minecraft server didn't answer in time." }), timeoutMs);
    sock.on("connect", () => sock.write(packet(1, 3, password))); // login
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (len < 10 || len > 8192) return finish({ ok: false, reason: "That doesn't look like an RCON server (check the port)." });
        if (buf.length < 4 + len) break;
        const id = buf.readInt32LE(4), type = buf.readInt32LE(8), body = buf.slice(12, 4 + len - 2).toString("utf8");
        buf = buf.slice(4 + len);
        if (!authed) {
          if (type !== 2) continue;
          if (id === -1) return finish({ ok: false, reason: "The RCON password was refused." });
          authed = true; sock.write(packet(2, 2, command)); // run the command
        } else if (id === 2) {
          text += body;
          clearTimeout(idle); idle = setTimeout(() => finish({ ok: true, text }), 350); // long replies arrive in pieces
        }
      }
    });
    sock.on("error", (e) => finish({ ok: false, reason: e.code === "ECONNREFUSED" ? "Nothing is listening on the RCON port. Is RCON turned on?" : e.code === "ENOTFOUND" ? "That RCON address doesn't exist." : "Couldn't connect to RCON (" + (e.code || "error") + ")." }));
    sock.on("close", () => finish({ ok: authed && text !== "", text, reason: authed ? "" : "The connection closed before RCON answered." }));
  });
}

module.exports = { run };
