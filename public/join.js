// Make it yours: sign up (a guest keeps their taste, city and Outsider) or
// sign in, on a glass card over the London map. Taste strands fan out from
// your dot to glowing orbs in Qloo's colours, one lighting per finished field.
import { token, setToken } from "/api.js";
import { makeMap, reduceMotion } from "/map3d.js";

const $ = (id) => document.getElementById(id);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOME = [-0.0776, 51.5255]; // The Hoxton, Shoreditch: where London guests are staying

// Qloo's domains, in their colours, placed around the edge of the screen so the card doesn't hide them.
const ORBS = [
  { label: "Music", color: "#148CC8", at: [-0.205, 51.548] },
  { label: "Film & TV", color: "#C8648C", at: [0.03, 51.552] },
  { label: "Food", color: "#DCB478", at: [0.045, 51.497] },
  { label: "Travel", color: "#00A08C", at: [-0.07, 51.468] },
  { label: "Fashion", color: "#8C8CC8", at: [-0.215, 51.49] },
];

let mode = location.hash === "#signin" ? "login" : "signup";
let me = null; // the signed-in guest, if any

const fieldsFor = () => (mode === "signup" ? ["firstName", "email", "password", "homeCity"] : ["email", "password"]);
function ok(k) {
  const v = $(k).value, t = v.trim();
  if (k === "email") return EMAIL.test(t);
  if (k === "password") return v.length >= 8;
  return t.length >= 2;
}

/* ---------- the strands on the map ---------- */

// A gentle curve from home to each orb: a quadratic Bézier bent to one side.
function curve(a, b, bend = 0.22, n = 32) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const c = [mx - dy * bend, my + dx * bend];
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
}

const map = makeMap($("map"), HOME);
let lit = 0;
const strandData = () => ({ type: "FeatureCollection", features: ORBS.map((o, i) => ({ type: "Feature", properties: { color: o.color, lit: i < lit }, geometry: { type: "LineString", coordinates: curve(HOME, o.at, i % 2 ? -0.22 : 0.22) } })) });
const orbData = () => ({ type: "FeatureCollection", features: ORBS.map((o, i) => ({ type: "Feature", properties: { color: o.color, label: o.label, lit: i < lit }, geometry: { type: "Point", coordinates: o.at } })) });

function drawStrands() {
  if (!map?.getSource("strands")) return;
  map.getSource("strands").setData(strandData());
  map.getSource("orbs").setData(orbData());
}

if (map) {
  map.on("style.load", () => {
    const on = (a, b) => ["case", ["get", "lit"], a, b];
    map.addSource("strands", { type: "geojson", data: strandData() });
    map.addSource("orbs", { type: "geojson", data: orbData() });
    map.addSource("me", { type: "geojson", data: { type: "Point", coordinates: HOME } });
    map.addLayer({ id: "strand-glow", type: "line", source: "strands", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": on(9, 0), "line-blur": 6, "line-opacity": on(0.45, 0) } });
    map.addLayer({ id: "strands", type: "line", source: "strands", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": on(2.6, 1.4), "line-opacity": on(0.95, 0.22) } });
    map.addLayer({ id: "orb-glow", type: "circle", source: "orbs", paint: { "circle-color": ["get", "color"], "circle-radius": on(34, 18), "circle-blur": 1, "circle-opacity": on(0.6, 0.18) } });
    map.addLayer({ id: "orbs", type: "circle", source: "orbs", paint: { "circle-color": ["get", "color"], "circle-radius": on(8, 5), "circle-opacity": on(1, 0.45), "circle-stroke-color": "#ffffff", "circle-stroke-width": on(1.5, 0) } });
    map.addLayer({ id: "orb-labels", type: "symbol", source: "orbs", layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, 1.6], "text-anchor": "top", "text-letter-spacing": 0.08, "text-transform": "uppercase" }, paint: { "text-color": ["get", "color"], "text-halo-color": "#0c0e16", "text-halo-width": 1.4, "text-opacity": on(1, 0.55) } });
    map.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-stroke-color": "#00ffa3", "circle-stroke-width": 3 } });
  });
  map.jumpTo({ center: HOME, zoom: 11.4, pitch: 58, bearing: -20 });
  map.once("load", () => {
    map.jumpTo({ center: HOME, zoom: 11.4, pitch: 58, bearing: -20 });
    if (reduceMotion()) return;
    let b = -20;
    const spin = () => { b -= 0.025; map.setBearing(b); requestAnimationFrame(spin); };
    map.once("idle", spin);
  });
}

/* ---------- the form ---------- */

function update() {
  const keys = fieldsFor();
  const done = keys.filter(ok).length;
  for (const k of keys) $(k).classList.toggle("ok", ok(k));
  const ready = done === keys.length;
  // Signing up: one strand per field, the fifth when everything's right. Signing in: two per field.
  lit = mode === "signup" ? done + (ready ? 1 : 0) : Math.min(5, done * 2 + (ready ? 1 : 0));
  document.querySelectorAll("#strands i").forEach((el, i) => el.classList.toggle("on", i < lit));
  $("strandNote").textContent = ready ? "All lit. You're ready." : `${lit} of 5 · your taste strands light up`;
  $("go").disabled = !ready;
  drawStrands();
}

function setMode(m) {
  mode = m;
  document.querySelectorAll("[data-for='signup']").forEach((el) => { el.hidden = m !== "signup"; });
  $("title").innerHTML = m === "signup" ? (me ? "Make it <em>yours.</em>" : "Find your people <em>tonight.</em>") : "Welcome <em>back.</em>";
  $("lede").textContent = m === "signup"
    ? (me ? "Keep your taste, your city and your Outsider. Add a name and a password so people with your taste can meet you." : "Land anywhere. See where people who share your taste are going out.")
    : "Sign in with your email and password.";
  $("go").textContent = m === "signup" ? (me ? "Make it mine" : "Outside") : "Sign in";
  $("altText").textContent = m === "signup" ? "Been here before?" : "New here?";
  $("switch").textContent = m === "signup" ? "Sign in" : "Make an account";
  $("password").autocomplete = m === "signup" ? "new-password" : "current-password";
  $("error").hidden = true;
  update();
}

for (const k of ["firstName", "email", "password", "homeCity"]) $(k).addEventListener("input", update);
$("switch").addEventListener("click", () => {
  setMode(mode === "signup" ? "login" : "signup");
  history.replaceState(null, "", mode === "login" ? "#signin" : "#");
});
addEventListener("hashchange", () => setMode(location.hash === "#signin" ? "login" : "signup"));

async function post(path, body) {
  const auth = me && token() ? { authorization: `Bearer ${token()}` } : {};
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("go").disabled) return;
  $("go").disabled = true;
  $("error").hidden = true;
  const email = $("email").value.trim(), password = $("password").value;
  try {
    const r = mode === "login"
      ? await post("/api/auth/login", { email, password })
      : await post("/api/auth/signup", { email, password, firstName: $("firstName").value.trim(), homeCity: $("homeCity").value.trim() });
    if (!r.res.ok) {
      if (mode === "signup" && r.res.status === 401) setMode("login");
      throw new Error(r.data.error || "Something went wrong. Try again.");
    }
    setToken(r.data.token);
    try { localStorage.removeItem("outside.guestToken"); } catch {}
    const u = r.data.user || {};
    // A guest who signed up makes the taste their own next.
    const next = r.data.upgraded ? "/taste#taste" : !u.avatar ? "/taste" : !u.favourites?.length ? "/taste#taste" : !u.city ? "/taste#city" : "/tonight";
    location.assign(next);
  } catch (err) {
    $("error").textContent = err.message;
    $("error").hidden = false;
    $("go").disabled = false;
  }
});

/* ---------- who's here ---------- */

async function start() {
  if (token()) {
    try {
      const res = await fetch("/api/me", { headers: { authorization: `Bearer ${token()}` } });
      const { user } = res.ok ? await res.json() : {};
      if (user && !user.guest && !user.readOnly) return location.replace("/tonight");
      if (user?.guest) me = user;
    } catch {}
  }
  if (!me) $("back").href = "/";
  setMode(mode);
}
start();
