// Reveal each section once, when it first scrolls into view. Nothing animates a second time.
(function () {
  const root = document.documentElement;
  const targets = [
    [".head, .about-grid > .card, .footer-inner, .form-card, .skin-wrap, .perks + p, #gallery-msg", "reveal"],
    [".stats, .grid, .about-grid > .grid", "reveal-kids"]
  ];
  const seen = new Set();
  const els = [];
  targets.forEach(([sel, cls]) => document.querySelectorAll(sel).forEach((e) => { if (!seen.has(e)) { seen.add(e); e.classList.add(cls); els.push(e); } }));

  const showAll = () => els.forEach((e) => e.classList.add("in"));
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return showAll();

  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  els.forEach((e) => io.observe(e));

  // safety net: if anything is still hidden a few seconds later, show it rather than leave a blank page
  setTimeout(() => { if (!root.classList.contains("js")) return; els.forEach((e) => { if (!e.classList.contains("in") && e.getBoundingClientRect().top < innerHeight * 1.2) e.classList.add("in"); }); }, 4000);
})();
