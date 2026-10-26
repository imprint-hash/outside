/**
 * Accounts and sessions.
 *
 * Sign-up takes an email, a password and a first name; a session is a signed
 * token the app sends back on every call. Passwords are kept only as a salted
 * scrypt hash. Signing up again with an existing email needs that account's
 * password, so nobody can take over an account by typing its email. Email
 * ownership is not proven yet, so new accounts are "unverified", and anyone
 * who chooses "only verified people can see me" is hidden from them.
 */

import "./env.js";
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
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

export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

/** "scrypt$<salt>$<hash>", both base64url. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${scryptSync(String(password), salt, 32).toString("base64url")}`;
}

export function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash || typeof password !== "string" || password.length > PASSWORD_MAX) return false;
  const want = Buffer.from(hash, "base64url");
  const got = scryptSync(password, Buffer.from(salt, "base64url"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

const DUMMY = hashPassword(randomBytes(12).toString("hex"));
const WRONG = "That email already has an account. Enter its password.";

/** Sign up, or sign back in with the same email and its password. */
export async function signUp({ email, password, firstName, homeCity } = {}) {
  const mail = String(email || "").trim().toLowerCase();
  const name = String(firstName || "").trim().slice(0, 30);
  if (!EMAIL.test(mail)) throw new AuthError("Enter a valid email address.", 400);
  const existing = (await list("users", (u) => u.email === mail))[0];
  if (existing) {
    if (!checkPassword(password, existing.passwordHash)) throw new AuthError(WRONG, 401);
    return { user: existing, token: issueToken(existing.id), returning: true };
  }
  if (typeof password !== "string" || password.length < PASSWORD_MIN) throw new AuthError(`Choose a password of at least ${PASSWORD_MIN} characters.`, 400);
  if (password.length > PASSWORD_MAX) throw new AuthError("That password is too long.", 400);
  if (!name) throw new AuthError("Tell us your first name.", 400);
  const user = await put("users", {
    email: mail,
    passwordHash: hashPassword(password),
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

/** Sign in with email and password. */
export async function logIn({ email, password } = {}) {
  const mail = String(email || "").trim().toLowerCase();
  const user = mail ? (await list("users", (u) => u.email === mail))[0] : null;
  const ok = checkPassword(password, user?.passwordHash || DUMMY); // same work whether or not the email exists
  if (!user || !ok) throw new AuthError("That email and password don't match.", 401);
  return { user, token: issueToken(user.id), returning: true };
}

/** What a person may see about themselves. Never the hash of anything secret. */
export const selfView = (u) => ({ id: u.id, email: u.email, firstName: u.firstName, homeCity: u.homeCity, city: u.city || null, verified: u.verified, favourites: u.favourites, visibility: u.visibility, avatar: u.avatar || null, stay: u.stay || null, role: u.role || null });

/** Someone else's avatar: theirs if they made one, the default if not. */
export const avatarOf = (u) => u?.avatar || DEFAULT_AVATAR;
