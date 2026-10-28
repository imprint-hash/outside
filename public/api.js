// Talking to the Outside API: the sign-in token rides along on every call,
// and a failed call throws the server's own plain-English message.
const KEY = "outside.token";

export const token = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { localStorage.setItem(KEY, t); } catch {} };
// Signing out lands on sign-in; opening "/" again makes a fresh guest.
export const signOut = () => { try { localStorage.removeItem(KEY); localStorage.removeItem(GUEST_KEY); } catch {} location.href = "/join#signin"; };

// While looking at the view-only demo venue, the guest's own session waits here.
const GUEST_KEY = "outside.guestToken";
export function enterDemoVenue(venueToken) {
  try { if (token()) localStorage.setItem(GUEST_KEY, token()); } catch {}
  setToken(venueToken);
}
export function leaveDemoVenue(to = null) {
  let back = null;
  try { back = localStorage.getItem(GUEST_KEY); localStorage.removeItem(GUEST_KEY); } catch {}
  if (back) setToken(back); else { try { localStorage.removeItem(KEY); } catch {} }
  location.href = to || (back ? "/tonight" : "/");
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  // A lost session (a guest cleaned up after 48 hours, say) starts again as a fresh guest; the banner offers sign-in.
  if (res.status === 401) { try { localStorage.removeItem(KEY); } catch {} location.href = "/"; throw new Error(data.error || "Please sign in."); }
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}

/** Send people who aren't signed in to the start, which makes them a guest. */
export function needSignIn() {
  if (!token()) location.replace("/");
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
