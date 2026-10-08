// Crystal PvP clips playing behind the live-status section: muted, no controls, looping the reel.
// A plain embed iframe, not the iframe_api script — one less thing that can be blocked or fail to load.
(function () {
  const IDS = ["hizSg5atZ84", "rL68dVgHahk", "YK9O111WTPw"];
  const wrap = document.getElementById("pvp-bg");
  const slot = document.getElementById("pvp-player");
  if (!wrap || !slot) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (navigator.connection && navigator.connection.saveData) return;

  // YouTube turns away embeds that have no real origin to check (error 153), which is every
  // page opened straight off disk as a file:// URL. Served over http the reel plays; opened
  // off disk the still backdrop stands in, rather than YouTube's error panel.
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  // a different clip opens each visit; the rest of the reel follows and then it loops,
  // and the rotation keeps a clip from playing straight into itself
  const start = Math.floor(Math.random() * IDS.length);
  const order = IDS.slice(start).concat(IDS.slice(0, start));

  const params = new URLSearchParams({
    autoplay: "1", mute: "1", controls: "0", loop: "1",
    playlist: order.slice(1).concat(order[0]).join(","),
    playsinline: "1", rel: "0", disablekb: "1", iv_load_policy: "3",
    enablejsapi: "1", origin: location.origin
  });

  let frame = null;

  function build() {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/" + order[0] + "?" + params;
    frame.title = "Crystal PvP footage";
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.tabIndex = -1;
    frame.setAttribute("frameborder", "0");
    frame.addEventListener("load", reveal);
    slot.replaceWith(frame);
    // a cross-origin load event is not guaranteed everywhere, so the clip is shown either way
    setTimeout(reveal, 2500);
  }

  function reveal() { wrap.classList.add("ready"); }

  // enablejsapi lets us pause over postMessage without pulling in the API script; if the
  // player ignores the message the clip simply keeps playing, which is harmless
  function cmd(func) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: [] }), "*");
    } catch (e) { /* nothing worth breaking the page over */ }
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { build(); cmd("playVideo"); }
        else cmd("pauseVideo");
      });
    }, { rootMargin: "400px 0px" });
    io.observe(wrap);
  } else {
    build();
  }

  // nothing streams while the tab is in the background
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return cmd("pauseVideo");
    const r = wrap.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) cmd("playVideo");
  });
})();
