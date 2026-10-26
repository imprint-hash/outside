// Shared pieces for every signed-in screen: the top bar, sheets (dialogs),
// toasts, ratings, faces and small formatters. Only fields the API returns
// are shown; anything missing is left out rather than filled in.
import { api, esc } from "/api.js";
import { avatarSVG, PLUMBOB } from "/avatar.js";

export const $ = (id) => document.getElementById(id);
export const icon = (name, cls = "") => `<span class="ms ${cls}" aria-hidden="true">${name}</span>`;

export const BRAND_MARK = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2" fill="none" stroke="#00ffa3" stroke-width="1.8"/><rect x="8.5" y="6" width="7" height="12" rx="1" fill="#00ffa3" opacity=".25"/><circle cx="14" cy="12.5" r="1.1" fill="#00ffa3"/></svg>`;

/** The top bar. `active`: "tonight" | "venue". */
export function topbar({ active = "tonight", user = null, cityLabel = "" } = {}) {
  const el = document.querySelector("header.topbar");
  if (!el) return;
  el.innerHTML = `
    <a class="brand" href="/tonight" aria-label="Outside, tonight">
      <span class="brand-mark">${BRAND_MARK}</span>
      <span class="brand-text"><span class="brand-name">Outside</span><span class="brand-by">Powered by Qloo</span></span>
    </a>
    <span class="divider-v" aria-hidden="true"></span>
    <a class="city-pill" href="/taste#city" title="Change city or where you're staying">
      <span class="ping" aria-hidden="true"></span>
      <span class="where" id="cityLabel">${esc(cityLabel?.city || user?.city || "Pick a city")}${cityLabel?.stay ? `<span class="stay"> · ${esc(cityLabel.stay)}</span>` : ""}</span>
      ${icon("expand_more")}
    </a>
    <nav class="topnav" aria-label="Main">
      <a href="/tonight" ${active === "tonight" ? 'aria-current="page"' : ""}>Tonight</a>
      <a href="/tonight#here">People here</a>
      <a href="/tonight#inbox">Hellos<span class="count" id="navCount" hidden></span></a>
      <a href="/venue" ${active === "venue" ? 'aria-current="page"' : ""}>For venues</a>
    </nav>
    <div class="top-tools">
      <a class="icon-btn" href="/tonight#inbox" aria-label="Hellos">${icon("waving_hand")}<span class="dot-badge" id="bellCount" hidden></span></a>
      <a class="me-btn" href="/tonight#settings" aria-label="You and settings">${user ? avatarSVG(user.avatar, { size: 34 }) : icon("person")}</a>
    </div>`;
}

export function setHelloCount(n) {
  for (const id of ["navCount", "bellCount"]) {
    const b = $(id);
    if (!b) continue;
    b.hidden = !n;
    b.textContent = n > 9 ? "9+" : String(n);
  }
}

/* ---------- sheets ---------- */

let sheetEl = null, onClose = null;
/** Open the one side sheet with a title and body HTML. Returns its body element. */
export function openSheet({ title, html = "", center = false, footer = "", closeTo = null }) {
  if (!sheetEl) {
    sheetEl = document.createElement("dialog");
    sheetEl.className = "sheet";
    document.body.append(sheetEl);
    sheetEl.addEventListener("close", () => { const f = onClose; onClose = null; f?.(); });
    sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) sheetEl.close(); });
  }
  sheetEl.classList.toggle("center", center);
  sheetEl.innerHTML = `
    <div class="sheet-head">
      ${closeTo ? `<button class="icon-btn" type="button" data-back aria-label="Back">${icon("arrow_back")}</button>` : ""}
      <h2 id="sheetTitle" tabindex="-1" autofocus>${esc(title)}</h2>
      <button class="icon-btn" type="button" data-close aria-label="Close">${icon("close")}</button>
    </div>
    <div class="sheet-body" id="sheetBody">${html}</div>
    ${footer}`;
  sheetEl.setAttribute("aria-labelledby", "sheetTitle");
  sheetEl.querySelector("[data-close]").onclick = () => sheetEl.close();
  if (closeTo) sheetEl.querySelector("[data-back]").onclick = closeTo;
  if (!sheetEl.open) sheetEl.showModal();
  sheetEl.querySelector(".sheet-body").scrollTop = 0;
  return sheetEl.querySelector(".sheet-body");
}
export const sheet = () => sheetEl;
export const sheetOpen = () => Boolean(sheetEl?.open);
export function onSheetClose(fn) { onClose = fn; }
export function closeSheet() { if (sheetEl?.open) sheetEl.close(); }

/* ---------- toast ---------- */

let toastTimer;
export function toast(text, { error = false, ms = 3200 } = {}) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = text;
  t.classList.toggle("err", error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- formatting ---------- */

export const stars = (n) => `<span class="stars" aria-label="${n} out of 5 stars">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
export const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/**
 * The dual rating. `all`: Qloo's rating (number|null). `ours`: { overall, likeYou }
 * from our reviews, or null. Pieces with no data are left out.
 */
export function ratingPill({ all = null, ours = null, flat = false } = {}) {
  const parts = [];
  const oc = ours?.overall?.count || 0;
  const od = demoCount(ours?.overall?.demo);
  if (all != null) parts.push(`<span class="all">All <b>${all.toFixed(1)} ★</b>${oc ? `<i>(+${compact(oc)} on Outside${od})</i>` : ""}</span>`);
  else if (ours?.overall?.avg != null) parts.push(`<span class="all">All <b>${ours.overall.avg.toFixed(1)} ★</b><i>(${compact(oc)}${od})</i></span>`);
  if (ours?.likeYou?.enough && ours.likeYou.avg != null) parts.push(`<span class="yours">${icon("star", "fill")}Your taste ${ours.likeYou.avg.toFixed(1)} ★${ours.likeYou.demo ? `<i>(${ours.likeYou.demo} demo)</i>` : ""}</span>`);
  return parts.length ? `<div class="rating${flat ? " flat" : ""}">${parts.join("")}</div>` : "";
}

export function timeIn(iso, tz, opts = { hour: "numeric", minute: "2-digit" }) {
  try { return new Date(iso).toLocaleTimeString("en-GB", { ...opts, timeZone: tz }); } catch { return ""; }
}
export function dayIn(iso, tz) {
  try {
    const d = new Date(iso);
    return { day: d.toLocaleDateString("en-GB", { day: "numeric", timeZone: tz }), mon: d.toLocaleDateString("en-GB", { month: "short", timeZone: tz }), wd: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: tz }) };
  } catch { return { day: "", mon: "", wd: "" }; }
}
export const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function tripText(trip) {
  if (!trip) return "";
  return `${trip.minutes} min ${trip.mode === "walk" ? "walk" : "drive"}`;
}

export function hoursFact(h) {
  if (!h?.known) return "";
  if (h.open) return `<span class="fact ${h.closingSoon ? "warn" : "ok"}">${icon("schedule")}Open${h.closesAt ? ` · closes ${esc(h.closesAt)}` : ""}</span>`;
  if (h.opensAt) return `<span class="fact warn">${icon("schedule")}Opens ${esc(h.opensAt)}${h.opensDay && h.opensDay !== "today" ? ` ${esc(h.opensDay)}` : ""}</span>`;
  return `<span class="fact warn">${icon("schedule")}Closed</span>`;
}

/** Avatars in a row, no names. `faces`: [{avatar}], `total` the full count. */
export function facesRow(faces = [], total = 0, max = 3) {
  const shown = faces.slice(0, max);
  const more = Math.max(0, total - shown.length);
  if (!shown.length && !more) return "";
  return `<div class="faces" aria-hidden="true">${shown.map((f) => `<span>${avatarSVG(f.avatar, { size: 30 })}</span>`).join("")}${more ? `<span class="more">+${more}</span>` : ""}</div>`;
}

export const demoTag = (x) => (x?.demo ? `<span class="tag tag-demo">Demo</span>` : "");
/** " · 2 demo" after a count that includes labelled demo people or reviews; "" when none. */
export const demoCount = (n) => (n ? ` · ${n} demo` : "");
export const isDemoName = (name) => /^Demo\s*·/.test(String(name || ""));

export { api, esc, avatarSVG, PLUMBOB };

/** Ask the browser for a position, resolving null if refused or slow. */
export function whereAmI(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60_000 },
    );
  });
}

/* ---------- local memory of conversations (the API has no list of them) ---------- */

const CHATS = "outside.chats";
export function chats() { try { return JSON.parse(localStorage.getItem(CHATS) || "[]"); } catch { return []; } }
export function rememberChat(c) {
  const all = chats().filter((x) => x.helloId !== c.helloId);
  all.unshift({ ...c, savedAt: new Date().toISOString() });
  try { localStorage.setItem(CHATS, JSON.stringify(all.slice(0, 40))); } catch {}
}
export function forgetChat(helloId) {
  try { localStorage.setItem(CHATS, JSON.stringify(chats().filter((x) => x.helloId !== helloId))); } catch {}
}
