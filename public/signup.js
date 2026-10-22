// Sign-up: each correct detail puts more passengers on the danfo, and the
// conductor's caption reacts to every keystroke. Press Outside and the bus
// drives away up the road to the Ikoyi Link Bridge.
const $ = (id) => document.getElementById(id);
const scene = $("scene");
const captionEl = $("caption");
const go = $("go");
const fields = { firstName: $("firstName"), email: $("email"), homeCity: $("homeCity") };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// What the conductor says. Captions react to what's in the box right now,
// right or not yet. {name} and {city} are filled in.
const SAY = {
  firstName: {
    empty: ["Who's getting on? 👀"],
    short: ["Keep going…", "One more letter at least"],
    tooLong: ["That's a whole sentence. Just your first name 😄"],
    ok: ["Welcome aboard! 🚌", "Nice name, take a seat", "On board! Who's next?", "The conductor is waving at you 👋"],
  },
  email: {
    empty: ["Nice to meet you, {name}. Your email next, we won't share it 🤐"],
    noAt: ["Where's the @? 🤔", "Still waiting for the @…"],
    noDomain: ["Gmail? Yahoo? Which one is it?", "Almost there, finish the address"],
    noDot: ["Needs a .com (or similar) at the end", "So close… add the .com"],
    ok: ["That email checks out ✅", "Squeeze in, there's always room for one more 😂", "Almost full!"],
  },
  homeCity: {
    empty: ["Where are you flying in from? ✈️"],
    short: ["Keep typing your city…"],
    ok: ["The bus is full! 🚌💨", "Engine running, almost time to go", "The conductor is shouting OUTSIDE 🎉"],
  },
  start: "The bus is waiting for passengers…",
  ready: "{city} to Lagos, let's go! Press Outside 👇",
};

/** Which caption pool a field's current text belongs to. "ok" means valid. */
function stateOf(k, v) {
  const t = v.trim();
  if (k === "firstName") return !t ? "empty" : t.length < 2 ? "short" : t.length > 20 || t.split(/\s+/).length > 2 ? "tooLong" : "ok";
  if (k === "email") {
    if (!t) return "empty";
    if (!t.includes("@")) return "noAt";
    if (!t.split("@")[1]) return "noDomain";
    return EMAIL.test(t) ? "ok" : "noDot";
  }
  return !t ? "empty" : t.length < 3 ? "short" : "ok";
}

const fill = (str) => str.replace("{name}", fields.firstName.value.trim().split(" ")[0] || "you").replace("{city}", fields.homeCity.value.trim() || "Home");

function say(text, bad = false) {
  captionEl.textContent = text;
  captionEl.classList.toggle("bad", bad);
}

// Lines rotate as you type, every few keys, so each one can be read.
let lastKey = null, lastState = null, shown = null, typed = 0;
function captionFor(k) {
  const st = stateOf(k, fields[k].value);
  const pool = SAY[k][st];
  if (k !== lastKey || st !== lastState || typed % 4 === 0 || !shown) shown = pool[Math.floor(typed / 4) % pool.length];
  lastKey = k;
  lastState = st;
  say(fill(shown), st !== "ok" && st !== "empty");
}

let level = 0;

function update(changed) {
  const ok = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, stateOf(k, el.value) === "ok"]));
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
  }
  if (changed) captionFor(changed);
  go.disabled = level < 3;
}

function wobble() {
  scene.classList.remove("wobble");
  void scene.getBBox();
  scene.classList.add("wobble");
}

// Every key is a little tap on the brakes: the tail lights flare.
let brakeTimer = null;
function brake() {
  scene.classList.add("brake");
  clearTimeout(brakeTimer);
  brakeTimer = setTimeout(() => scene.classList.remove("brake"), 180);
}

for (const [k, el] of Object.entries(fields)) {
  el.addEventListener("input", () => { typed++; brake(); update(k); });
  el.addEventListener("focus", () => { typed = 0; update(k); });
  el.addEventListener("blur", () => {
    update(null);
    if (el.value.trim() && stateOf(k, el.value) !== "ok") { wobble(); captionFor(k); }
    else if (level === 3) say(fill(SAY.ready));
  });
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (level < 3) return;
  go.disabled = true;
  $("error").hidden = true;
  scene.classList.add("drive");
  say("Next stop: Ikoyi Link Bridge. You're outside 🎉");
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

say(SAY.start);
update(null);
