(function () {
  const { h, api } = UI;
  const root = document.getElementById("apply-root");
  const identity = { name: "", discord: "", minecraft: "" };
  const answers = {}; // question id -> value

  api("/api/apply/questions").then((qs) => {
    const steps = [{ title: "Who you are", identity: true }];
    qs.forEach((q) => {
      let s = steps.find((x) => x.title === q.step);
      if (!s) steps.push((s = { title: q.step, questions: [] }));
      s.questions.push(q);
    });
    if (steps.length === 1) return root.replaceChildren(h("div", { class: "card center muted" }, "Applications are closed right now — check back later."));
    let i = 0;
    draw();

    function field(label, el, hint) {
      return h("label", { class: "field" }, h("span", { class: "label mono muted" }, label), el, hint ? h("span", { class: "mono small muted" }, hint) : null);
    }
    function input(obj, key, attrs) {
      return h("input", Object.assign({ value: obj[key] || "", oninput: (e) => (obj[key] = e.target.value) }, attrs));
    }
    function qEl(q) {
      const set = (v) => (answers[q.id] = v);
      if (q.type === "paragraph") return field(q.label + (q.required ? " *" : ""), h("textarea", { rows: 4, maxlength: 1500, oninput: (e) => set(e.target.value) }, answers[q.id] || ""), q.hint);
      if (q.type === "select") return field(q.label + (q.required ? " *" : ""), h("select", { onchange: (e) => set(e.target.value) }, h("option", { value: "" }, "Choose…"), q.options.map((o) => h("option", { value: o, selected: answers[q.id] === o }, o))), q.hint);
      if (q.type === "checkbox") return h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!answers[q.id], onchange: (e) => set(e.target.checked) }), " " + q.label + (q.required ? " *" : ""));
      if (q.type === "screenshot") return field(q.label + (q.required ? " *" : ""), h("input", { type: "url", maxlength: 500, placeholder: "https://…", value: answers[q.id] || "", oninput: (e) => set(e.target.value) }), q.hint);
      return field(q.label + (q.required ? " *" : ""), h("input", { maxlength: 300, value: answers[q.id] || "", oninput: (e) => set(e.target.value) }), q.hint);
    }

    function draw(err) {
      const s = steps[i];
      const body = s.identity
        ? [field("Your name *", input(identity, "name", { maxlength: 60 })), field("Discord username *", input(identity, "discord", { maxlength: 40 })), field("Minecraft username *", input(identity, "minecraft", { maxlength: 16 }))]
        : s.questions.map(qEl);
      const last = i === steps.length - 1;
      root.replaceChildren(h("div", { class: "card stack" },
        h("p", { class: "mono small muted" }, "Step " + (i + 1) + " of " + steps.length),
        h("div", { class: "bar" }, h("span", { style: "width:" + ((i + 1) / steps.length) * 100 + "%" })),
        h("h3", { style: "font-size:24px;font-weight:800" }, s.title),
        ...body,
        err ? h("p", { class: "mono small", style: "color:var(--pink)" }, err) : null,
        h("div", { class: "row" },
          i > 0 ? h("button", { class: "ghost", type: "button", onclick: () => { i--; draw(); } }, "BACK") : null,
          h("button", { class: "btn-primary inline", style: "font-size:14px;padding:14px 28px", type: "button", onclick: last ? submit : next }, last ? "SUBMIT APPLICATION" : "NEXT"))));
    }

    function missing() {
      const s = steps[i];
      if (s.identity) return !identity.name.trim() || !identity.discord.trim() || !identity.minecraft.trim() ? "Please fill in all three fields." : "";
      const q = s.questions.find((x) => x.required && !answers[x.id]);
      return q ? "Please answer: " + q.label : "";
    }
    function next() { const m = missing(); if (m) return draw(m); i++; draw(); }
    async function submit() {
      const m = missing();
      if (m) return draw(m);
      try {
        await api("/api/apply", { body: Object.assign({}, identity, { answers: Object.keys(answers).map((id) => ({ id, value: answers[id] })) }) });
        root.replaceChildren(h("div", { class: "card stack" }, h("h3", { style: "font-size:24px;font-weight:800" }, "Application sent 🌸"), h("p", { class: "muted" }, "Thank you! The staff team will read it and reach out to you on Discord.")));
      } catch (e) { draw(e.message); }
    }
  }).catch((e) => root.replaceChildren(h("div", { class: "card muted" }, e.message)));
})();
