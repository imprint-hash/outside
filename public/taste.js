// Setup in three steps: create your avatar, say what you love back home,
// then where you're staying (or use your location).
import { api, needSignIn, esc } from "/api.js";
import { avatarSVG } from "/avatar.js";

needSignIn();
const $ = (id) => document.getElementById(id);

function showStep(n) {
  for (const i of [1, 2, 3]) $(`step${i}`).hidden = i !== n;
  document.querySelectorAll(".steps li").forEach((li) => li.classList.toggle("on", Number(li.dataset.step) <= n));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
const fail = (id, err) => { $(id).textContent = err.message; $(id).hidden = false; };

/* ---------- step 1: the avatar maker ---------- */

let OPTIONS, avatar;
const NAMES = { afro: "Afro", braids: "Braids", locs: "Locs", bun: "Bun", short: "Short", lowcut: "Low cut", long: "Long", bald: "Bald", glasses: "Glasses", beard: "Beard", cap: "Cap", earrings: "Earrings" };
let tab = "skin";

function drawPreview() {
  $("preview").innerHTML = avatarSVG(avatar, { size: 168, plumbob: "strong" });
}

function drawChoices() {
  const list = OPTIONS[tab];
  const isColour = ["skin", "hairColour", "outfit"].includes(tab);
  $("choices").innerHTML = list.map((v) => {
    const on = tab === "extras" ? avatar.extras.includes(v) : avatar[tab] === v;
    return isColour
      ? `<button type="button" class="swatch${on ? " on" : ""}" data-v="${esc(v)}" style="--c:${esc(v)}" aria-label="${esc(v)}" aria-pressed="${on}"></button>`
      : `<button type="button" class="choice${on ? " on" : ""}" data-v="${esc(v)}" aria-pressed="${on}">${esc(NAMES[v] || v)}</button>`;
  }).join("");
}

$("choices").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  const v = b.dataset.v;
  if (tab === "extras") avatar.extras = avatar.extras.includes(v) ? avatar.extras.filter((x) => x !== v) : [...avatar.extras, v];
  else avatar[tab] = v;
  drawChoices();
  drawPreview();
});

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  tab = t.dataset.tab;
  document.querySelectorAll(".tab").forEach((x) => { x.classList.toggle("on", x === t); x.setAttribute("aria-selected", String(x === t)); });
  drawChoices();
}));

// Surprise me: a random look, like rolling the dice in a character creator.
$("dice").addEventListener("click", () => {
  const r = (xs) => xs[Math.floor(Math.random() * xs.length)];
  avatar = { skin: r(OPTIONS.skin), hair: r(OPTIONS.hair), hairColour: r(OPTIONS.hairColour.slice(0, 5)), outfit: r(OPTIONS.outfit), extras: OPTIONS.extras.filter(() => Math.random() < 0.25) };
  $("dice").classList.remove("roll");
  void $("dice").offsetWidth;
  $("dice").classList.add("roll");
  drawChoices();
  drawPreview();
});

$("saveAvatar").addEventListener("click", async () => {
  $("err1").hidden = true;
  try {
    await api("/api/me/avatar", { method: "POST", body: { avatar } });
    showStep(2);
  } catch (err) { fail("err1", err); }
});

/* ---------- step 2: what you love back home ---------- */

const chosen = []; // { type, name }

function drawChosen() {
  $("chosen").innerHTML = chosen.map((c, i) => `<button type="button" class="chip-on" data-i="${i}" aria-label="Remove ${esc(c.name)}">${esc(c.name)} <span aria-hidden="true">×</span></button>`).join("");
  const enough = chosen.length >= 2;
  $("saveTaste").disabled = !enough;
  $("tasteHint").textContent = enough ? `${chosen.length} picked. Add more for sharper picks, or continue.` : `Pick at least ${2 - chosen.length} more to continue.`;
}
$("chosen").addEventListener("click", (e) => {
  const b = e.target.closest("[data-i]");
  if (b) { chosen.splice(Number(b.dataset.i), 1); drawChosen(); }
});

for (const box of document.querySelectorAll(".picker")) {
  const type = box.dataset.type;
  const input = box.querySelector("input");
  const list = box.querySelector(".suggest");
  let timer, seq = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { list.innerHTML = ""; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      list.innerHTML = `<li class="muted">Searching…</li>`;
      try {
        const { results } = await api(`/api/search?type=${type}&q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        list.innerHTML = results.length
          ? results.map((r) => `<li><button type="button" data-name="${esc(r.name)}">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : ""}<span><b>${esc(r.name)}</b>${r.detail ? `<small>${esc(String(r.detail).slice(0, 60))}</small>` : ""}</span></button></li>`).join("")
          : `<li class="muted">Nothing found for "${esc(q)}". Check the spelling?</li>`;
      } catch (err) { list.innerHTML = `<li class="muted">${esc(err.message)}</li>`; }
    }, 300);
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-name]");
    if (!b) return;
    if (!chosen.some((c) => c.name === b.dataset.name)) chosen.push({ type, name: b.dataset.name });
    input.value = "";
    list.innerHTML = "";
    drawChosen();
  });
}

$("saveTaste").addEventListener("click", async () => {
  $("err2").hidden = true;
  $("saveTaste").disabled = true;
  $("saveTaste").textContent = "Reading your taste…";
  try {
    const { missing } = await api("/api/me/taste", { method: "POST", body: { items: chosen } });
    if (missing?.length) { $("err2").textContent = `Couldn't match ${missing.join(", ")}, so they were left out.`; $("err2").hidden = false; }
    showStep(3);
  } catch (err) { fail("err2", err); }
  $("saveTaste").textContent = "Next: where are you staying?";
  $("saveTaste").disabled = chosen.length < 2;
});

/* ---------- step 3: where you're staying ---------- */

let gps = null;
$("stay").addEventListener("input", () => { gps = null; $("saveStay").disabled = $("stay").value.trim().length < 2; });

$("useGps").addEventListener("click", () => {
  if (!navigator.geolocation) { $("gpsNote").textContent = "This browser can't share location. Type your hotel or area instead."; $("gpsNote").hidden = false; return; }
  $("gpsNote").textContent = "Asking your phone where you are…";
  $("gpsNote").hidden = false;
  navigator.geolocation.getCurrentPosition(
    (p) => {
      gps = { lat: p.coords.latitude, lon: p.coords.longitude, label: "Your location" };
      $("stay").value = "";
      $("gpsNote").textContent = "Got it. We use this only to find places near you, and never show it to anyone.";
      $("saveStay").disabled = false;
    },
    () => { $("gpsNote").textContent = "Location wasn't shared. Type your hotel or area instead."; },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
});

$("saveStay").addEventListener("click", () => {
  const stay = gps || $("stay").value.trim();
  try { localStorage.setItem("outside.stay", JSON.stringify(stay)); } catch {}
  location.href = "/tonight";
});

/* ---------- start ---------- */

const [{ options, default: dflt }, { user }] = await Promise.all([api("/api/avatar-options"), api("/api/me")]);
OPTIONS = options;
avatar = structuredClone(user.avatar || dflt);
drawChoices();
drawPreview();
if (user.avatar && user.favourites?.length) showStep(3);
else if (user.avatar) showStep(2);
