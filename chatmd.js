// Discord-style message formatting, built with DOM nodes only (never innerHTML), plus the emoji lists.
window.ChatMD = (function () {
  const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀", "💯", "🙏", "😍", "😎", "🤔", "👏", "😅", "🥲", "😭", "😡", "🤯", "✅", "❌", "⭐", "💀", "🫡", "🤝", "💪", "🎮", "⚔️", "🛡️", "🌸", "😴", "🤣", "😇", "🥳", "😬", "🙌", "💔", "☠️", "🏆", "🍀"];

  const emojiSrc = (id, animated) => "api/chat/media?u=" + encodeURIComponent(`https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48`);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // bold, italics, underline, strikethrough, code, spoilers, links and custom emoji
  const INLINE = /(`+)([\s\S]+?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\|\|([\s\S]+?)\|\||\*([^\s*][^*]*?)\*|(?<![\w])_([^\s_][^_]*?)_(?![\w])|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|<(a?):(\w{2,32}):(\d{5,25})>/g;

  function inline(str) {
    const frag = document.createDocumentFragment();
    let last = 0, m;
    const re = new RegExp(INLINE.source, "g"); // its own search position, because nested formatting calls this function again
    while ((m = re.exec(str))) {
      if (m.index > last) frag.append(str.slice(last, m.index));
      last = re.lastIndex;
      if (m[2] != null) frag.append(el("code", "md-code", m[2].trim()));
      else if (m[3] != null) { const e = el("strong"); e.append(inline(m[3])); frag.append(e); }
      else if (m[4] != null) { const e = el("u"); e.append(inline(m[4])); frag.append(e); }
      else if (m[5] != null) { const e = el("s"); e.append(inline(m[5])); frag.append(e); }
      else if (m[6] != null) { const e = el("span", "md-spoiler"); e.append(inline(m[6])); e.title = "Click to reveal"; e.addEventListener("click", () => e.classList.add("open")); frag.append(e); }
      else if (m[7] != null || m[8] != null) { const e = el("em"); e.append(inline(m[7] != null ? m[7] : m[8])); frag.append(e); }
      else if (m[9] != null) { const a = el("a", "md-link", m[9]); a.href = m[9]; a.target = "_blank"; a.rel = "noopener noreferrer"; frag.append(a); }
      else if (m[11] != null) { const i = el("img", "emo"); i.src = emojiSrc(m[12], !!m[10]); i.alt = ":" + m[11] + ":"; i.title = ":" + m[11] + ":"; i.loading = "lazy"; frag.append(i); }
    }
    if (last < str.length) frag.append(str.slice(last));
    return frag;
  }

  // block level: ``` code blocks ```, and > quotes
  function render(text) {
    const root = document.createDocumentFragment();
    const parts = String(text || "").split(/```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/gi);
    parts.forEach((part, i) => {
      if (i % 2 === 1) { const pre = el("pre", "md-pre"); pre.append(el("code", "", part.replace(/^\n+|\n+$/g, ""))); root.append(pre); return; }
      const lines = part.split("\n");
      let quote = null, buf = [];
      const flush = () => { if (buf.length) { const d = el("div", "md-line"); d.append(inline(buf.join("\n"))); (quote || root).append(d); buf = []; } };
      lines.forEach((ln) => {
        const q = /^>>?>? ?(.*)$/.exec(ln);
        if (q && /^>/.test(ln)) { if (!quote) { flush(); quote = el("blockquote", "md-quote"); root.append(quote); } buf.push(q[1]); }
        else { if (quote) { flush(); quote = null; } buf.push(ln); }
      });
      flush();
    });
    return root;
  }
  return { render, QUICK, emojiSrc };
})();
