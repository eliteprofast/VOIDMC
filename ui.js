// Small shared helpers. Everything is built with textContent so user text can never run as HTML.
window.UI = (function () {
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  // Sends the login cookie automatically. A 401 on any page except the login page sends you to log in.
  async function api(url, opts) {
    opts = opts || {};
    let r;
    try { r = await fetch(url.replace(/^\/+/, ""), { method: opts.body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: "same-origin", signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw new Error(e && e.name === "TimeoutError" ? "That took too long. Please try again." : "Couldn't reach the server. Is it running?"); }
    let d = {};
    try { d = await r.json(); } catch (e) {
      // Not JSON: this address is a plain file host (like GitHub Pages) with no VSMP server behind it.
      if (!r.ok) { const err = new Error("This address has no VSMP server, so this feature only works on the real site, not on GitHub Pages."); err.status = r.status; throw err; }
    }
    if (r.status === 401 && !url.startsWith("/api/auth/") && url !== "/api/me" && !location.pathname.endsWith("login.html")) { location.href = "login.html"; }
    if (!r.ok) { const err = new Error(d.error || "Something went wrong. Please try again."); err.status = r.status; err.data = d; throw err; }
    return d;
  }
  function clientId() {
    try {
      let id = localStorage.getItem("vsmp_client");
      if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem("vsmp_client", id); }
      return id;
    } catch (e) { return "anon-" + Math.random().toString(36).slice(2); }
  }
  return { h, api, clientId };
})();
