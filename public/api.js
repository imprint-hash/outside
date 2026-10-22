// Talking to the Outside API: the sign-in token rides along on every call,
// and a failed call throws the server's own plain-English message.
const KEY = "outside.token";

export const token = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const signOut = () => { try { localStorage.removeItem(KEY); } catch {} location.href = "/"; };

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(token() ? { authorization: `Bearer ${token()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401) { signOut(); throw new Error(data.error || "Please sign in."); }
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
  return data;
}

/** Send people who aren't signed in back to the bus. */
export function needSignIn() {
  if (!token()) location.replace("/");
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
