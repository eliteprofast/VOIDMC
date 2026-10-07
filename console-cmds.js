// Admin console: a small set of safe, named commands. It is NOT a shell, so it can never run arbitrary programs on the server.
// Each command says who may use it. ctx supplies what the site already has (database, helpers), so this file stays independent.
const rcon = require("./rcon");
const lbData = require("./lb-data");

const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const oneLine = (s, n) => String(s || "").replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, n);
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 90 ? s + "s ago" : s < 5400 ? Math.round(s / 60) + "m ago" : s < 129600 ? Math.round(s / 3600) + "h ago" : Math.round(s / 86400) + "d ago"; };

// who may run each command: "any" (anyone with console access), "owner", or a permission name
const COMMANDS = {
  help:      { who: "any", usage: "help", about: "list the commands you can use" },
  status:    { who: "any", usage: "status", about: "server health, storage, counts" },
  mc:        { who: "any", usage: "mc", about: "is the Minecraft server up, and who's online" },
  rcon:      { who: "console", usage: "rcon <command>", about: "run any Minecraft server command (RCON)" },
  say:       { who: "console", usage: "say <message>", about: "broadcast a message in the game" },
  whitelist: { who: "console", usage: "whitelist add|remove <name>", about: "add or remove a player from the whitelist" },
  players:   { who: "console", usage: "players", about: "list the players in the game right now" },
  announce:  { who: "announcement", usage: "announce <message> | announce off", about: "set or clear the site announcement bar" },
  gallery:   { who: "gallery", usage: "gallery [pending] | approve <id> | hide <id> | delete <id>", about: "review moments" },
  orders:    { who: "orders", usage: "orders [pending]", about: "list orders" },
  order:     { who: "orders", usage: "order <id> pending|paid|delivered", about: "update an order's status" },
  apps:      { who: "applications", usage: "apps [pending]", about: "list staff applications" },
  diag:      { who: "owner", usage: "diag", about: "which settings the site can see (names only, never values)" },
  lb:        { who: "leaderboard", usage: "lb [top] | lb set <name> balance=N kills=N deaths=N playtime=H clan=X | lb remove <name>", about: "view or change the leaderboard" },
  logs:      { who: "owner", usage: "logs [count]", about: "recent server log lines" },
  users:     { who: "owner", usage: "users [search]", about: "list site accounts" },
  user:      { who: "owner", usage: "user <email>", about: "details for one account" },
  kick:      { who: "owner", usage: "kick <email>", about: "log an account out everywhere" },
  ban:       { who: "owner", usage: "ban <email>", about: "suspend an account (logged out, can't log in)" },
  unban:     { who: "owner", usage: "unban <email>", about: "lift a suspension" },
  resetpw:   { who: "owner", usage: "resetpw <email> <new password>", about: "set a new password" },
  audit:     { who: "owner", usage: "audit [count]", about: "who ran which console command" }
};

async function run(line, ctx) {
  const { me, owner, can, db, save } = ctx;
  line = String(line || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600);
  if (!line) return { text: "" };
  const space = line.indexOf(" ");
  const cmd = (space < 0 ? line : line.slice(0, space)).toLowerCase();
  const rest = space < 0 ? "" : line.slice(space + 1).trim();
  const args = rest ? rest.split(/\s+/) : [];
  const def = COMMANDS[cmd];
  if (!def) return { text: `Unknown command "${cmd.slice(0, 30)}". Type help.`, error: true };
  const allowed = def.who === "any" || (def.who === "owner" ? owner : def.who === "console" ? can("console") : can(def.who) || owner);
  if (!allowed) return { text: `You don't have permission to use "${cmd}".`, error: true };
  const bad = (t) => ({ text: t, error: true });
  const audit = (what) => { db.audit.push({ at: Date.now(), who: me, cmd: what }); if (db.audit.length > 300) db.audit.splice(0, db.audit.length - 200); save(); };

  switch (cmd) {
    case "help": {
      const rows = Object.entries(COMMANDS).filter(([, d]) => d.who === "any" || (d.who === "owner" ? owner : d.who === "console" ? can("console") : can(d.who) || owner));
      const w = Math.max(...rows.map(([, d]) => d.usage.length)) + 3;
      return { text: rows.map(([, d]) => d.usage.padEnd(w) + d.about).join("\n") + "\n\nTip: use the up and down arrows to repeat earlier commands. Type clear to empty the screen." };
    }
    case "status": {
      const pending = (a, f) => a.filter(f).length;
      return { text: [
        "uptime        " + Math.round(process.uptime() / 60) + " min",
        "node          " + process.version,
        "storage       " + ctx.storage,
        "accounts      " + db.users.length + " (" + db.admins.length + " admins, " + (db.banned || []).length + " suspended)",
        "logged in     " + Object.keys(db.sessions).length + " sessions",
        "gallery       " + db.gallery.length + " (" + pending(db.gallery, (g) => g.status === "pending") + " waiting)",
        "orders        " + db.orders.length + " (" + pending(db.orders, (o) => o.status === "pending") + " pending)",
        "applications  " + db.applications.length + " (" + pending(db.applications, (a) => a.status === "pending") + " pending)",
        "minecraft     " + ctx.mcAddress,
        "rcon          " + (ctx.rconReady ? "set up -> " + ctx.rconHost + ":" + ctx.rconPort : "not set up (the site sees no RCON_PASSWORD; type diag)"),
        "discord       " + (ctx.discordReady ? "set up" : "not set up")
      ].join("\n") };
    }
    case "mc": {
      const r = await ctx.mcPing();
      return { text: r.online ? `ONLINE  ${r.now}/${r.max} players  ${r.version || ""}${r.ms != null ? "  " + r.ms + "ms" : ""}${r.motd ? "\nMOTD    " + r.motd : ""}` : "OFFLINE  " + (r.reason || "no answer") + "\nAddress: " + ctx.mcAddress };
    }
    case "rcon": case "say": case "whitelist": case "players": {
      if (!ctx.rconReady) return bad("RCON isn't set up. In Render add RCON_PASSWORD (and RCON_PORT if it isn't 25575), after turning on enable-rcon and setting rcon.password in your server's server.properties.");
      let command;
      if (cmd === "rcon") { if (!rest) return bad("Usage: rcon <command>   for example: rcon list"); command = oneLine(rest, 300).replace(/^\//, ""); }
      else if (cmd === "say") { if (!rest) return bad("Usage: say <message>"); command = "say " + oneLine(rest, 250); }
      else if (cmd === "players") command = "list";
      else {
        const [act, name] = args;
        if (!["add", "remove"].includes(act) || !NAME_RE.test(name || "")) return bad("Usage: whitelist add|remove <name>   (name: letters, numbers, underscore, up to 16)");
        command = "whitelist " + act + " " + name;
      }
      audit("rcon: " + command);
      const r = await rcon.run(ctx.rconHost, ctx.rconPort, ctx.rconPassword, command);
      if (!r.ok && !r.text) return bad(r.reason || "No answer from the server.");
      return { text: (r.text || "(the server gave no reply)").replace(/§./g, "").slice(0, 3000) };
    }
    case "announce": {
      if (!rest) return bad("Usage: announce <message>   or   announce off");
      if (rest.toLowerCase() === "off") { if (db.announcement) db.announcement.active = false; save(); audit("announce off"); return { text: "Announcement hidden." }; }
      db.announcement = { message: oneLine(rest, 200), tag: "NEWS", link_url: "", link_label: "", active: true }; save(); audit("announce " + oneLine(rest, 60));
      return { text: "Announcement is live on the site." };
    }
    case "gallery": {
      const [a, id] = args;
      if (!a || a === "pending" || a === "all") {
        const list = db.gallery.filter((g) => a === "all" || g.status === "pending").slice(-25);
        return { text: list.length ? list.map((g) => `#${g.id}  ${g.status.padEnd(8)} ${g.kind.padEnd(7)} ${g.title.slice(0, 30)}  by ${g.player}  (${g.voters.length} votes)`).join("\n") : "Nothing waiting for review." };
      }
      const g = db.gallery.find((x) => x.id === Number(id));
      if (!["approve", "hide", "delete"].includes(a) || !g) return bad("Usage: gallery approve|hide|delete <id>   (see ids with: gallery pending)");
      if (a === "approve") g.status = "approved"; else if (a === "hide") g.status = "pending"; else { db.gallery.splice(db.gallery.indexOf(g), 1); ctx.dropImage(g); }
      save(); audit("gallery " + a + " " + g.id);
      return { text: `Moment #${g.id} ${a === "delete" ? "deleted" : a === "approve" ? "approved" : "hidden"}.` };
    }
    case "orders": {
      const list = db.orders.filter((o) => args[0] !== "pending" || o.status === "pending").slice(-25);
      return { text: list.length ? list.map((o) => `#${o.id}  ${o.status.padEnd(9)} ${o.username.padEnd(16)} ${o.totalText || "$" + o.total.toFixed(2)}  ${o.items.map((i) => i.qty + "x " + i.name).join(", ")}  (${ago(o.created)})`).join("\n") : "No orders." };
    }
    case "order": {
      const o = db.orders.find((x) => x.id === Number(args[0]));
      if (!o || !["pending", "paid", "delivered"].includes(args[1])) return bad("Usage: order <id> pending|paid|delivered   (see ids with: orders)");
      o.status = args[1]; save(); audit("order " + o.id + " " + o.status);
      return { text: "Order #" + o.id + " for " + o.username + " is now " + o.status + "." };
    }
    case "apps": {
      const list = db.applications.filter((a) => args[0] !== "pending" || a.status === "pending").slice(-25);
      return { text: list.length ? list.map((a) => `#${a.id}  ${a.status.padEnd(11)} ${a.name.slice(0, 20).padEnd(20)} mc:${a.minecraft}  (${ago(a.created)})`).join("\n") : "No applications." };
    }
    case "diag": {
      const env = ctx.env || {};
      const expected = ["OWNER_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID", "RCON_PASSWORD", "RCON_PORT", "RCON_HOST", "MC_ADDRESS", "TRUST_PROXY", "PUBLIC_URL", "DATA_DIR"];
      const rows = expected.map((k) => {
        const v = env[k];
        if (v == null || v === "") return k.padEnd(24) + "not set";
        const warn = [/^\s|\s$/.test(v) ? "has a space at the start or end" : "", /^["']|["']$/.test(v) ? "has quote marks" : "", /^=/.test(v) ? "starts with =" : ""].filter(Boolean).join(", ");
        return k.padEnd(24) + "set (" + v.length + " characters)" + (warn ? "   <- WARNING: " + warn : "");
      });
      const known = new Set(expected);
      const odd = Object.keys(env).filter((k) => /rcon|discord|supabase|upstash|owner|minecraft|mc_/i.test(k) && !known.has(k));
      rows.push("", "Save folder in use: " + (ctx.dataDir || "?") + (ctx.dataDirNote ? "\n  WARNING: " + ctx.dataDirNote : ""));
      return { text: rows.join("\n") + (odd.length ? "\n\nOther settings with related names (is one of these a misspelling?):\n  " + odd.join("\n  ") : "") + "\n\nOnly names and lengths are shown. Values are never displayed." };
    }
    case "lb": {
      const sub = (args[0] || "top").toLowerCase();
      if (sub === "top") { const d = lbData.list(db, { sort: "balance", limit: 10 }, Date.now()); return { text: d.players.length ? d.players.map((p) => "#" + p.rank + " " + p.name.padEnd(16) + " bal " + p.balance + "  K " + p.kills + "  D " + p.deaths + (p.clan ? "  [" + p.clan + "]" : "")).join("\n") + "\n(" + d.count + " players)" : "The leaderboard is empty." }; }
      if (sub === "remove") { const n = lbData.remove(db, args[1] || ""); save(); audit("lb remove " + (args[1] || "")); return n ? { text: "Removed " + args[1] + "." } : bad("No player with that name."); }
      if (sub === "set") {
        const row = { name: args[1] || "" };
        for (const kv of args.slice(2)) { const m = /^(balance|kills|deaths|playtime|clan)=(.*)$/i.exec(kv); if (!m) return bad("Use key=value pairs, for example: lb set Steve balance=5000 kills=12"); row[m[1].toLowerCase()] = m[2]; }
        const r = lbData.upsert(db, [row], Date.now()); save(); audit("lb set " + row.name);
        return r.updated ? { text: "Saved " + row.name + "." } : bad("Refused: " + r.rejected.join(", "));
      }
      return bad("Usage: lb | lb set <name> balance=N kills=N deaths=N playtime=H clan=X | lb remove <name>");
    }
    case "logs": {
      const n = Math.min(200, Math.max(1, parseInt(args[0], 10) || 40));
      return { text: ctx.logs.slice(-n).join("\n") || "(no log lines yet)" };
    }
    case "users": {
      const q = (args[0] || "").toLowerCase();
      const list = db.users.filter((u) => !q || u.email.includes(q)).slice(0, 60);
      return { text: (list.length ? list.map((u) => u.email.padEnd(34) + [db.admins.includes(u.email) ? "admin" : "", u.discord ? "discord:" + (u.discord.global_name || u.discord.username) : "", (db.banned || []).includes(u.email) ? "SUSPENDED" : ""].filter(Boolean).join("  ")).join("\n") : "No accounts match.") + `\n(${db.users.length} accounts in total)` };
    }
    case "user": {
      const e = (args[0] || "").toLowerCase(), u = db.users.find((x) => x.email === e);
      if (!u) return bad("No account with that email. Usage: user <email>");
      const sess = Object.values(db.sessions).filter((s) => s.email === e).length;
      return { text: [`email        ${u.email}`, `created      ${u.created ? new Date(u.created).toISOString().slice(0, 10) : "?"}`, `admin        ${db.admins.includes(e) ? "yes: " + (db.adminPerms[e] || ["all"]).join(", ") : "no"}`, `discord      ${u.discord ? (u.discord.global_name || u.discord.username) + " (" + u.discord.id + ")" : "not connected"}`, `sessions     ${sess}`, `suspended    ${(db.banned || []).includes(e) ? "yes" : "no"}`].join("\n") };
    }
    case "kick": case "ban": case "unban": {
      const e = (args[0] || "").toLowerCase();
      if (!e) return bad("Usage: " + cmd + " <email>");
      if (e === ctx.ownerEmail) return bad("You can't do that to the owner account.");
      if (!db.users.find((x) => x.email === e)) return bad("No account with that email.");
      db.banned = db.banned || [];
      if (cmd === "ban" && !db.banned.includes(e)) db.banned.push(e);
      if (cmd === "unban") db.banned = db.banned.filter((x) => x !== e);
      if (cmd !== "unban") ctx.endSessions(e);
      save(); audit(cmd + " " + e);
      return { text: cmd === "kick" ? e + " was logged out everywhere." : cmd === "ban" ? e + " is suspended and logged out." : e + " can log in again." };
    }
    case "resetpw": {
      const e = (args[0] || "").toLowerCase(), pw = rest.slice((args[0] || "").length).trim();
      if (!e || pw.length < 8) return bad("Usage: resetpw <email> <new password of 8+ characters>");
      const r = ctx.resetPassword(e, pw);
      if (r.error) return bad(r.error);
      audit("resetpw " + e + " ***");
      return { text: `Password for ${e} was ${r.created ? "set (new account created)" : "changed"}, and their login block was lifted. Give them the new password.` };
    }
    case "audit": {
      const n = Math.min(100, Math.max(1, parseInt(args[0], 10) || 25));
      return { text: db.audit.slice(-n).map((a) => new Date(a.at).toISOString().replace("T", " ").slice(0, 19) + "  " + a.who + "  " + a.cmd).join("\n") || "(nothing yet)" };
    }
  }
  return bad("Unknown command.");
}

module.exports = { run, COMMANDS };
