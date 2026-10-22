/**
 * Accounts and sessions.
 *
 * Sign-up takes an email and a first name; a session is a signed token the
 * app sends back on every call. Email ownership is not proven yet (that comes
 * with the hosted login), so new accounts are "unverified", and anyone who
 * chooses "only verified people can see me" is hidden from them.
 */

import "./env.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { get, put, list } from "./store.js";
import { DEFAULT_AVATAR } from "./avatar.js";

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

const SECRET = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new AuthError("SESSION_SECRET is missing on the server.", 500);
  return s;
};
const DAYS_30 = 30 * 24 * 3600_000;
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (body) => createHmac("sha256", SECRET()).update(body).digest("base64url");

export function issueToken(userId, now = Date.now()) {
  const body = b64(JSON.stringify({ u: userId, exp: now + DAYS_30 }));
  return `${body}.${sign(body)}`;
}

export async function userFromToken(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) throw new AuthError("Please sign in.");
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new AuthError("Your session is not valid. Please sign in again.");
  const { u, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
  if (Date.now() > exp) throw new AuthError("Your session has expired. Please sign in again.");
  const user = await get("users", u);
  if (!user) throw new AuthError("That account no longer exists.");
  return user;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Sign up, or sign back in with the same email. */
export async function signUp({ email, firstName, homeCity }) {
  const mail = String(email || "").trim().toLowerCase();
  const name = String(firstName || "").trim().slice(0, 30);
  if (!EMAIL.test(mail)) throw new AuthError("Enter a valid email address.", 400);
  const existing = (await list("users", (u) => u.email === mail))[0];
  if (existing) return { user: existing, token: issueToken(existing.id), returning: true };
  if (!name) throw new AuthError("Tell us your first name.", 400);
  const user = await put("users", {
    email: mail,
    firstName: name,
    homeCity: String(homeCity || "").trim().slice(0, 40) || null,
    verified: false,
    favourites: [],
    avatar: null,
    visibility: "everyone",
    createdAt: new Date().toISOString(),
  });
  return { user, token: issueToken(user.id), returning: false };
}

/** What a person may see about themselves. Never the hash of anything secret. */
export const selfView = (u) => ({ id: u.id, email: u.email, firstName: u.firstName, homeCity: u.homeCity, verified: u.verified, favourites: u.favourites, visibility: u.visibility, avatar: u.avatar || null });

/** Someone else's avatar: theirs if they made one, the default if not. */
export const avatarOf = (u) => u?.avatar || DEFAULT_AVATAR;
