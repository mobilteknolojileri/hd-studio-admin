/**
 * HD Studio licence admin page.
 *
 * A static page (GitHub Pages) talking to the `admin` Edge Function. Nothing
 * secret lives here: the page is public, the login is not. The access token is
 * kept in sessionStorage for this tab only, and every cell is built with
 * createElement and textContent, never from an HTML string, so a customer name
 * can not become markup. A test enforces that.
 */

// Public project URL; the page must be allowed in the ADMIN_ORIGINS secret.
const API = "https://mqyfohctaaqdjpninyrj.supabase.co/functions/v1/admin";
const MODULES = ["backup", "friends", "names", "extract"];
const MODULE_LABELS = {
  backup: "Yedekle",
  friends: "Arkadaş Ekle",
  names: "İsim Ver",
  extract: "Hesaptan Çıkar",
};
const STORE = "hds-admin-session";

// The CSP meta tag cannot set frame-ancestors, so refuse to run framed.
if (window.top !== window.self) {
  document.body.textContent = "Bu sayfa çerçeve içinde açılamaz.";
  throw new Error("framed");
}

const $ = (id) => document.getElementById(id);
const state = { token: null, email: null, licenses: [], editing: null };

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (tag === "button") e.type = "button";
  if (text !== undefined && text !== null) e.textContent = String(text);
  if (cls) e.className = cls;
  return e;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("tr-TR")} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
}

function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}

function toDayInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function setMsg(text, isError) {
  const m = $("app-msg");
  m.textContent = text || "";
  m.className = isError ? "msg error" : "msg";
}

function saveSession() {
  if (state.token) {
    sessionStorage.setItem(STORE, JSON.stringify({ token: state.token, email: state.email }));
  } else {
    sessionStorage.removeItem(STORE);
  }
}

function loadSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE) || "null");
    if (s?.token) {
      state.token = s.token;
      state.email = s.email;
    }
  } catch {
    // corrupt entry: start logged out
  }
}

function showLogin() {
  state.token = null;
  state.email = null;
  state.licenses = [];
  saveSession();
  $("login").hidden = false;
  $("app").hidden = true;
  $("logout").hidden = true;
  $("who").textContent = "";
  $("password").value = "";
}

function showApp() {
  $("login").hidden = true;
  $("app").hidden = false;
  $("logout").hidden = false;
  $("who").textContent = state.email || "";
  refresh();
}

async function api(action, payload) {
  const headers = { "content-type": "application/json" };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  let data;
  try {
    const res = await fetch(API, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    data = await res.json();
  } catch {
    return { ok: false, code: "network", message: "Sunucuya ulaşılamadı." };
  }
  if (!data.ok && data.code === "unauthorized" && action !== "login") {
    showLogin();
    $("login-error").textContent = "Oturum süresi doldu, tekrar giriş yapın.";
  }
  return data;
}

async function refresh() {
  setMsg("Yükleniyor…");
  const data = await api("list");
  if (!data.ok) {
    setMsg(data.message || "Liste alınamadı.", true);
    return;
  }
  state.licenses = data.licenses || [];
  setMsg("");
  render();
}

async function mutate(action, payload) {
  setMsg("Kaydediliyor…");
  const data = await api(action, payload);
  if (!data.ok) {
    setMsg(data.message || "İşlem başarısız.", true);
    return;
  }
  await refresh();
}

function statusCell(license) {
  const td = el("td");
  const active = license.status === "active";
  td.appendChild(el("span", active ? "Çalışıyor" : "Kapalı", active ? "badge ok" : "badge bad"));
  return td;
}

function moduleCell(license) {
  const td = el("td");
  for (const m of license.modules || []) td.appendChild(el("span", MODULE_LABELS[m] || m, "chip"));
  return td;
}

function machineCell(license) {
  const machines = license.activations || [];
  const td = el("td");
  const det = el("details");
  det.appendChild(el("summary", `${machines.length} / ${license.max_machines}`));
  const ul = el("ul");
  for (const a of machines) {
    const line = `${a.hostname || "Bilinmeyen bilgisayar"} · son açılış: ${fmtDateTime(a.last_seen_at)}`;
    ul.appendChild(el("li", line));
  }
  if (machines.length === 0)
    ul.appendChild(el("li", "Henüz hiçbir bilgisayarda açılmadı.", "muted"));
  det.appendChild(ul);
  td.appendChild(det);
  return td;
}

function actionCell(license) {
  const machines = license.activations || [];
  const td = el("td");
  const box = el("div", null, "actions");

  const edit = el("button", "Düzenle");
  edit.addEventListener("click", () => openDialog(license));
  box.appendChild(edit);

  const reset = el("button", "Bilgisayarları sıfırla");
  reset.disabled = machines.length === 0;
  reset.addEventListener("click", () => {
    const q = `${license.customer_name} için kayıtlı ${machines.length} bilgisayar unutulsun mu? Aynı anahtarla yeni bir bilgisayara kurulum yapılabilir.`;
    if (confirm(q)) mutate("reset_machines", { id: license.id });
  });
  box.appendChild(reset);

  const del = el("button", "Sil", "danger");
  del.addEventListener("click", () => {
    const q = `${license.customer_name} silinsin mi? Anahtar bir daha çalışmaz ve bu işlem geri alınamaz.`;
    if (confirm(q)) mutate("delete", { id: license.id });
  });
  box.appendChild(del);

  td.appendChild(box);
  return td;
}

function render() {
  const q = $("filter").value.trim().toLowerCase();
  const rows = $("rows");
  rows.replaceChildren();
  let shown = 0;

  for (const l of state.licenses) {
    if (q && !String(l.customer_name).toLowerCase().includes(q)) continue;
    shown++;
    const tr = el("tr");
    tr.appendChild(el("td", l.customer_name));
    tr.appendChild(statusCell(l));
    tr.appendChild(machineCell(l));
    tr.appendChild(moduleCell(l));
    tr.appendChild(el("td", l.expires_at ? fmtDay(l.expires_at) : "Süresiz"));
    tr.appendChild(el("td", l.note || ""));
    tr.appendChild(el("td", fmtDay(l.created_at)));
    tr.appendChild(actionCell(l));
    rows.appendChild(tr);
  }

  $("empty").hidden = shown !== 0;
}

// --- create / edit dialog ----------------------------------------------------
const dlg = $("dlg-license");
const form = $("license-form");

for (const m of MODULES) {
  const lab = el("label");
  const cb = el("input");
  cb.type = "checkbox";
  cb.name = "modules";
  cb.value = m;
  cb.checked = true;
  lab.appendChild(cb);
  lab.appendChild(el("span", MODULE_LABELS[m]));
  $("module-checks").appendChild(lab);
}

function openDialog(license) {
  state.editing = license || null;
  $("dlg-title").textContent = license
    ? `Lisansı düzenle: ${license.customer_name}`
    : "Yeni lisans";
  $("customer-row").hidden = Boolean(license);
  form.customer_name.value = "";
  form.max_machines.value = license ? license.max_machines : 2;
  form.expires_at.value = license ? toDayInput(license.expires_at) : "";
  form.note.value = license ? license.note || "" : "";
  const mods = license ? license.modules : MODULES;
  for (const cb of form.querySelectorAll("input[name=modules]")) {
    cb.checked = mods.includes(cb.value);
  }
  $("dlg-error").textContent = "";
  dlg.showModal();
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const checked = [...form.querySelectorAll("input[name=modules]")].filter((cb) => cb.checked);
  const payload = {
    max_machines: Number.parseInt(form.max_machines.value, 10),
    modules: checked.map((cb) => cb.value),
    // Not on screen: there is one channel today, and editing keeps whatever a
    // licence already has.
    channel: state.editing?.channel || "stable",
    expires_at: form.expires_at.value || null,
    note: form.note.value.trim() || null,
  };
  let action = "update";
  if (state.editing) {
    payload.id = state.editing.id;
  } else {
    action = "create";
    payload.customer_name = form.customer_name.value.trim();
  }

  $("dlg-save").disabled = true;
  const data = await api(action, payload);
  $("dlg-save").disabled = false;
  if (!data.ok) {
    $("dlg-error").textContent = data.message || "Kaydedilemedi.";
    return;
  }
  dlg.close();
  if (action === "create") {
    $("key-text").textContent = data.key;
    $("key-customer").textContent = `${payload.customer_name} · ${payload.max_machines} makine`;
    $("dlg-key").showModal();
  }
  refresh();
});

// --- login / logout ----------------------------------------------------------
async function login() {
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) {
    $("login-error").textContent = "E-posta ve parola gerekli.";
    return;
  }
  $("login-btn").disabled = true;
  $("login-error").textContent = "";
  const data = await api("login", { email, password });
  $("login-btn").disabled = false;
  if (!data.ok) {
    $("login-error").textContent = data.message || "Giriş başarısız.";
    return;
  }
  state.token = data.access_token;
  state.email = data.email;
  saveSession();
  showApp();
}

$("new-btn").addEventListener("click", () => openDialog(null));
$("dlg-cancel").addEventListener("click", () => dlg.close());
$("key-copy").addEventListener("click", () => {
  navigator.clipboard?.writeText($("key-text").textContent).then(() => {
    $("key-copy").textContent = "Kopyalandı";
  });
});
$("key-close").addEventListener("click", () => {
  $("dlg-key").close();
  $("key-text").textContent = "";
  $("key-copy").textContent = "Kopyala";
});
$("login-btn").addEventListener("click", login);
$("password").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") login();
});
$("logout").addEventListener("click", showLogin);
$("refresh-btn").addEventListener("click", refresh);
$("filter").addEventListener("input", render);

loadSession();
if (state.token) showApp();
else showLogin();
