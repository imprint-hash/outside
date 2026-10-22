// Sign-up: each correct detail puts more passengers on the danfo, with a caption.
// Press Outside and it drives off over the Ikoyi Link Bridge.
const $ = (id) => document.getElementById(id);
const scene = $("scene");
const caption = $("caption");
const go = $("go");
const fields = { firstName: $("firstName"), email: $("email"), homeCity: $("homeCity") };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const check = {
  firstName: (v) => v.trim().length >= 2,
  email: (v) => EMAIL.test(v.trim()),
  homeCity: (v) => v.trim().length >= 2,
};

// What the conductor says at each level. {name} and {city} are filled in.
const LINES = {
  0: "The danfo is waiting for passengers…",
  1: ["Oya, enter, {name}! 🚌", "{name} don enter. Who's next?"],
  2: ["Shift, make another person sit 😂", "One chance remaining!"],
  3: ["Danfo don full. {city} to Lagos, we move! 🚌💨", "Conductor is shouting OUTSIDE! 🎉"],
  badEmail: "Abeg, that email no correct 😅",
  shortName: "Just your first name, at least two letters",
};
const pick = (x) => (Array.isArray(x) ? x[Math.floor(Math.random() * x.length)] : x);
const fill = (s) => s.replace("{name}", fields.firstName.value.trim().split(" ")[0] || "you").replace("{city}", fields.homeCity.value.trim() || "Home");

let level = 0;
let lastLine = {};

function update(changed) {
  const ok = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, check[k](el.value)]));
  // Levels stack in form order: name, then email, then city.
  const next = ok.firstName ? (ok.email ? (ok.homeCity ? 3 : 2) : 1) : 0;

  for (const [k, el] of Object.entries(fields)) {
    el.classList.toggle("ok", ok[k]);
    el.classList.toggle("bad", !ok[k] && el.value.trim().length > 0 && document.activeElement !== el);
  }

  if (next !== level) {
    if (next < level) wobble();
    level = next;
    scene.dataset.level = String(level);
    lastLine[level] = pick(LINES[level]);
    say(fill(lastLine[level]));
  } else if (changed === "homeCity" && level === 3) {
    say(fill(lastLine[3] || pick(LINES[3])));
  } else if (changed === "firstName" && level >= 1) {
    say(fill(lastLine[level] || pick(LINES[level])));
  }
  go.disabled = level < 3;
}

function say(text, bad = false) {
  caption.textContent = text;
  caption.classList.toggle("bad", bad);
}

function wobble() {
  scene.classList.remove("wobble");
  void scene.getBBox();
  scene.classList.add("wobble");
}

for (const [k, el] of Object.entries(fields)) {
  el.addEventListener("input", () => update(k));
  el.addEventListener("blur", () => {
    update(k);
    if (k === "email" && el.value.trim() && !check.email(el.value)) { wobble(); say(LINES.badEmail, true); }
    if (k === "firstName" && el.value.trim().length === 1) say(LINES.shortName, true);
  });
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (level < 3) return;
  go.disabled = true;
  $("error").hidden = true;
  scene.classList.add("drive");
  say("Next stop: Ikoyi Link Bridge… you're outside 🎉");
  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value.trim()]))),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Something went wrong. Try again.");
    try { localStorage.setItem("outside.token", body.token); } catch {}
    setTimeout(() => { location.href = body.user.favourites?.length ? "/tonight" : "/taste"; }, 2600);
  } catch (err) {
    scene.classList.remove("drive");
    $("error").textContent = err.message;
    $("error").hidden = false;
    go.disabled = false;
  }
});

update();
