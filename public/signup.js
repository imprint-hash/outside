// Sign-up: "Step outside". A front door on a night street; a window lights
// up for each detail that's right. Press Outside and the door opens and your
// avatar walks out into the city. Returning people sign in the same way.
import { avatarSVG } from "/avatar.js";

const $ = (id) => document.getElementById(id);
const street = $("street");
const go = $("go");
const caption = $("caption");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let mode = "signup"; // or "login"
const ALL = ["firstName", "email", "password", "homeCity"];
const fieldsFor = () => (mode === "signup" ? ALL : ["email", "password"]);

// Already signed in? Go straight on.
try { if (localStorage.getItem("outside.token")) location.replace("/tonight"); } catch {}

function stateOf(k, v) {
  const t = v.trim();
  if (k === "firstName") return !t ? "empty" : t.length < 2 ? "short" : t.length > 20 || t.split(/\s+/).length > 2 ? "long" : "ok";
  if (k === "email") return !t ? "empty" : !t.includes("@") ? "noAt" : !t.split("@")[1] ? "noDomain" : EMAIL.test(t) ? "ok" : "noDot";
  if (k === "password") return !v ? "empty" : v.length < 8 ? "short" : "ok";
  return !t ? "empty" : t.length < 2 ? "short" : "ok";
}

const SAY = {
  firstName: { empty: "Who's stepping out?", short: "Keep going…", long: "Just your first name is fine.", ok: "Nice to meet you, {name}. A light comes on." },
  email: { empty: "Your email next. We never show it to anyone.", noAt: "Missing the @", noDomain: "Finish the address after the @", noDot: "Needs an ending like .com", ok: "That email works." },
  password: { empty: "Pick a password, at least 8 characters.", short: "{left} more characters", ok: "Good password." },
  homeCity: { empty: "Where's home? Any city in the world.", short: "Keep typing your city…", ok: "Every light's on. Press Outside." },
};
const LOGIN_READY = "Welcome back. Press Outside.";

function say(text, bad = false) {
  caption.textContent = text;
  caption.classList.toggle("bad", bad);
}

function update(changed) {
  const keys = fieldsFor();
  const ok = keys.map((k) => stateOf(k, $(k).value) === "ok");
  for (const [i, k] of keys.entries()) {
    const el = $(k);
    el.classList.toggle("ok", ok[i]);
    el.classList.toggle("bad", !ok[i] && el.value.trim().length > 0 && document.activeElement !== el);
  }
  // Each right detail lights its own window (two each when signing in).
  const lit = new Set();
  keys.forEach((k, i) => { if (ok[i]) (mode === "signup" ? [i] : [i * 2, i * 2 + 1]).forEach((w) => lit.add(w)); });
  document.querySelectorAll(".win").forEach((w) => w.classList.toggle("lit", lit.has(Number(w.dataset.w))));
  const level = Math.round((lit.size / 4) * 3);
  street.dataset.level = String(level);
  const ready = ok.every(Boolean);
  go.disabled = !ready;

  if (changed) {
    const st = stateOf(changed, $(changed).value);
    const name = $("firstName").value.trim().split(" ")[0] || "you";
    let text = SAY[changed][st].replace("{name}", name).replace("{left}", String(8 - $("password").value.length));
    if (ready) text = mode === "login" ? LOGIN_READY : SAY.homeCity.ok;
    say(text, st !== "ok" && st !== "empty");
  }
}

function setMode(m) {
  mode = m;
  document.querySelectorAll("[data-for='signup']").forEach((el) => { el.hidden = m !== "signup"; });
  $("title").innerHTML = m === "signup" ? "Step <em>outside</em>" : "Welcome <em>back</em>";
  $("lede").textContent = m === "signup"
    ? "Land anywhere, and see where your people are tonight: places, events and people who share your taste."
    : "Sign in with your email and password.";
  $("switch").textContent = m === "signup" ? "I already have an account" : "I'm new here";
  $("password").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("error").hidden = true;
  say(m === "signup" ? "Fill in the lights. One window for each detail." : "Two details and the door opens.");
  update(null);
}

for (const k of ALL) {
  $(k).addEventListener("input", () => update(k));
  $(k).addEventListener("focus", () => update(k));
  $(k).addEventListener("blur", () => {
    update(null);
    if ($(k).value.trim() && stateOf(k, $(k).value) !== "ok") { street.classList.remove("shake"); void street.offsetWidth; street.classList.add("shake"); }
  });
}
$("switch").addEventListener("click", () => setMode(mode === "signup" ? "login" : "signup"));

async function post(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch {}
  return { res, data };
}

// The default look walks out until they make their own avatar.
let look = null;
fetch("/api/avatar-options").then((r) => r.json()).then((d) => { look = d.default; }).catch(() => {});

function walkOut(avatar) {
  const svg = avatarSVG(avatar || look, { size: 44 }).replace('<svg class="avatar"', '<svg class="avatar" x="178" y="396"');
  $("walker").innerHTML = svg;
  street.classList.add("open");
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (go.disabled) return;
  go.disabled = true;
  $("error").hidden = true;
  say(mode === "signup" ? "Opening the door…" : "Checking…");
  const email = $("email").value.trim();
  const password = $("password").value;
  try {
    let r;
    if (mode === "login") {
      r = await post("/api/auth/login", { email, password });
      // Before passwords existed, signing up again with the same email signed you in.
      if (r.res.status === 404 && /endpoint/i.test(r.data.error || "")) r = await post("/api/auth/signup", { email, password });
    } else {
      r = await post("/api/auth/signup", { email, password, firstName: $("firstName").value.trim(), homeCity: $("homeCity").value.trim() });
    }
    if (!r.res.ok) {
      if (mode === "signup" && r.res.status === 401) setMode("login");
      throw new Error(r.data.error || "Something went wrong. Try again.");
    }
    try { localStorage.setItem("outside.token", r.data.token); } catch {}
    const u = r.data.user || {};
    const next = !u.avatar ? "/taste" : !u.favourites?.length ? "/taste#taste" : !u.city ? "/taste#city" : "/tonight";
    say(r.data.returning || mode === "login" ? `Welcome back${u.firstName ? `, ${u.firstName}` : ""}.` : "You're outside.");
    if (reduce) { setTimeout(() => location.assign(next), 400); return; }
    walkOut(u.avatar);
    setTimeout(() => location.assign(next), 2700);
  } catch (err) {
    street.classList.remove("open");
    $("error").textContent = err.message;
    $("error").hidden = false;
    go.disabled = false;
    say("");
  }
});

setMode("signup");
