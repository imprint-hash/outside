/**
 * Work that should finish after the answer has gone out (warming a city's
 * events, for example). On Vercel the promise is handed to the platform's
 * `waitUntil`, so the function isn't frozen half-way; this is what
 * @vercel/functions does internally, without installing it. Anywhere else the
 * promise simply runs on, and a failure is logged rather than lost.
 */

export function background(promise) {
  const p = Promise.resolve(promise).catch((err) => console.error("Background work failed:", err));
  const waitUntil = globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil;
  if (typeof waitUntil === "function") waitUntil(p);
  return p;
}
