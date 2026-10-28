// First load: no form wall. Signed in already? Straight to Tonight. If not,
// the server makes a guest in London and we go to Tonight as that guest.
import { token, setToken } from "/api.js";

const $ = (id) => document.getElementById(id);

async function enter() {
  $("startErr").hidden = true;
  $("start").setAttribute("aria-busy", "true");
  $("startNote").textContent = "No sign-up. You're a guest, with a taste to start from.";
  try {
    const res = await fetch("/api/demo/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || "We couldn't get you in just now.");
    setToken(data.token);
    location.replace("/tonight");
  } catch (err) {
    $("start").setAttribute("aria-busy", "false");
    $("startNote").textContent = err.message;
    $("startErr").hidden = false;
  }
}

$("retry").addEventListener("click", enter);
if (token()) location.replace("/tonight");
else enter();
