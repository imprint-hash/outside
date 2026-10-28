// First load: no form wall. Signed in already? Straight to Tonight. If not,
// the server makes a guest in London and we go to Tonight as that guest.
import { token, setToken } from "/api.js";

const $ = (id) => document.getElementById(id);

// Looks only: a soft aurora behind, and the city rotating while the guest is
// made. Loaded on the side, so a failed effect never stops the page.
let rotator = null;
function effects() {
  import("/fx/soft-aurora.js")
    .then(({ mountSoftAurora }) => mountSoftAurora($("aurora"), {
      color1: "#148CC8", color2: "#C8648C", spectrum: 0.35, brightness: 1.3,
      bandHeight: 0.3, bandSpread: 0.9, scale: 1.2, speed: 0.5, opacity: 0.75,
      intro: false, // the screen is often up for a second only
    }))
    .catch(() => {});
  import("/fx/rotating-text.js")
    .then(({ rotatingText }) => {
      if (done) return;
      rotator = rotatingText($("startCity"), { texts: ["London", "Lagos", "Cape Town", "New York", "Tokyo"], rotationInterval: 1400 });
    })
    .catch(() => {});
}
let done = false;

async function enter() {
  $("startErr").hidden = true;
  $("start").setAttribute("aria-busy", "true");
  $("startNote").textContent = "No sign-up. You're a guest, with a taste to start from.";
  try {
    const res = await fetch("/api/demo/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || "We couldn't get you in just now.");
    setToken(data.token);
    done = true;
    rotator?.stop("London");
    location.replace("/tonight");
  } catch (err) {
    rotator?.stop("London");
    $("start").setAttribute("aria-busy", "false");
    $("startNote").textContent = err.message;
    $("startErr").hidden = false;
  }
}

$("retry").addEventListener("click", enter);
if (token()) location.replace("/tonight");
else { effects(); enter(); }
