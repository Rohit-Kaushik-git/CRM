/* App shell: auth flow, navigation, shared helpers. */
const $ = (s) => document.querySelector(s);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(d) { return d || "—"; }
function toast(msg, ok = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = (ok ? "ok" : "err") + " show";
  setTimeout(() => (t.className = ""), 3500);
}
async function guard(fn) { // wrap async UI actions: surface failures as toasts
  try { return await fn(); } catch (e) { toast(e.message); }
}
function latestNote(t) {
  const notes = (t.task_notes || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return notes[0]
    ? `<span class="note">"${esc(notes[0].note)}" — ${esc(notes[0].author?.name || "import")}</span>`
    : `<span class="muted">—</span>`;
}

const NAV = [
  { hash: "clients",    label: "Clients",       roles: ["admin"] },
  { hash: "open-items", label: "Open Items",    roles: ["admin"] },
  { hash: "team",       label: "Team",          roles: ["admin"] },
  { hash: "my-items",   label: "My Open Items", roles: ["implementor"] },
  { hash: "my-clients", label: "My Clients",    roles: ["implementor"] },
];

function buildNav(me) {
  $("#nav-items").innerHTML = NAV.filter((n) => n.roles.includes(me.role))
    .map((n) => `<a href="#${n.hash}" data-nav="${n.hash}">${n.label}</a>`).join("");
}

async function renderRoute() {
  const me = Store.getMe();
  if (!me) return;
  const view = $("#view");
  const home = me.role === "admin" ? "clients" : "my-items";
  const hash = location.hash.replace(/^#/, "") || home;
  const [name, arg] = hash.split("/");
  document.querySelectorAll("#nav-items a").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name));
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const routes = {
    "clients":    () => Views.renderClients(view),
    "client":     () => Views.renderClientDetail(view, Number(arg)),
    "open-items": () => Views.renderOpenItems(view),
    "team":       () => Views.renderTeam(view),
    "my-items":   () => Views.renderMyItems(view),
    "my-clients": () => Views.renderMyClients(view),
  };
  await guard(routes[name] || routes[home]);
}

function showLogin() { $("#login").style.display = "flex"; $("#app").style.display = "none"; }

function showReset() {
  $("#login").style.display = "none";
  $("#app").style.display = "none";
  $("#reset").style.display = "flex";
}

function showApp(me) {
  $("#login").style.display = "none";
  $("#app").style.display = "flex";
  $("#who").textContent = `${me.name} · ${me.role}`;
  buildNav(me);
  renderRoute();
}

function wireLogin() {
  let mode = "signin";
  const setMode = (m) => {
    mode = m;
    $("#f-name").style.display = m === "signup" ? "block" : "none";
    $("#login-submit").textContent = m === "signup" ? "Sign up" : "Sign in";
    $("#tab-signin").classList.toggle("active", m === "signin");
    $("#tab-signup").classList.toggle("active", m === "signup");
  };
  $("#tab-signin").onclick = () => setMode("signin");
  $("#tab-signup").onclick = () => setMode("signup");
  $("#login-form").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const email = $("#f-email").value, pw = $("#f-password").value;
      if (mode === "signup") {
        await Store.signUp($("#f-name").value.trim(), email, pw);
        await Store.signIn(email, pw);
      } else {
        await Store.signIn(email, pw);
      }
      const me = await Store.loadMe();
      if (me) { location.hash = ""; showApp(me); }
    });
  };
}

function wireReset() {
  $("#forgot").onclick = (e) => {
    e.preventDefault();
    guard(async () => {
      const email = $("#f-email").value.trim() || prompt("Your @uzio.com email:");
      if (!email) return;
      await Store.resetPassword(email);
      toast("Reset link sent — check your inbox", true);
    });
  };
  $("#reset-form").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const p1 = $("#r-password").value, p2 = $("#r-password2").value;
      if (p1 !== p2) { toast("Passwords don't match"); return; }
      await Store.updatePassword(p1);
      toast("Password updated", true);
      location.hash = "";
      const me = await Store.loadMe();
      $("#reset").style.display = "none";
      me ? showApp(me) : showLogin();
    });
  };
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("DOMContentLoaded", async () => {
  wireLogin();
  wireReset();
  $("#signout").onclick = () => guard(async () => {
    await Store.signOut(); location.hash = ""; showLogin();
  });
  Store.onPasswordRecovery(() => showReset());
  if (location.hash.includes("type=recovery")) { showReset(); return; }
  const me = await (Store.loadMe().catch((e) => { toast(e.message); return null; }));
  me ? showApp(me) : showLogin();
});
