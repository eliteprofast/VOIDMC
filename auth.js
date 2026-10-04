(function () {
  const { h, api } = UI;
  const root = document.getElementById("auth-root");
  const go = () => { window.location.href = "/"; };

  // Already logged in? Skip the form.
  api("/api/me").then(go).catch(() => view("login"));

  function view(name) {
    const msg = h("p", { class: "mono small", style: "color:var(--pink);min-height:1.2em" });
    const field = (label, attrs) => h("label", { class: "field" }, h("span", { class: "label mono muted" }, label), h("input", attrs));
    const submit = (label) => h("button", { class: "btn-primary inline", style: "font-size:14px;padding:14px;width:100%", type: "submit" }, label);
    const run = (fn) => async (e) => { e.preventDefault(); msg.textContent = "…"; try { await fn(new FormData(e.target)); } catch (x) { msg.textContent = x.message; } };
    const link = (text, to) => h("button", { class: "linkbtn", type: "button", onclick: () => view(to) }, text);

    if (name === "login") {
      return root.replaceChildren(h("form", { class: "stack", onsubmit: run(async (f) => { await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } }); go(); }) },
        h("h3", { style: "font-size:24px;font-weight:800;text-align:center" }, "Welcome back"),
        h("p", { class: "muted center small" }, "Log in to enter the realm."),
        field("Email", { name: "email", type: "email", autocomplete: "email", required: true }),
        field("Password", { name: "password", type: "password", autocomplete: "current-password", required: true }),
        msg, submit("LOG IN"), h("div", { class: "row" }, link("Create an account", "register"))));
    }
    return root.replaceChildren(h("form", { class: "stack", onsubmit: run(async (f) => {
      if (f.get("password") !== f.get("confirm")) throw new Error("The passwords don't match.");
      await api("/api/auth/register", { body: { email: f.get("email"), password: f.get("password") } });
      go();
    }) },
      h("h3", { style: "font-size:24px;font-weight:800;text-align:center" }, "Create your account"),
      h("p", { class: "muted center small" }, "Sign up to enter the realm."),
      field("Email", { name: "email", type: "email", autocomplete: "email", required: true }),
      field("Password (8+ characters)", { name: "password", type: "password", autocomplete: "new-password", minlength: 8, required: true }),
      field("Confirm password", { name: "confirm", type: "password", autocomplete: "new-password", minlength: 8, required: true }),
      msg, submit("CREATE ACCOUNT"), h("div", { class: "row" }, link("I already have an account", "login"))));
  }
})();
