import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./_core/env";
import {
  createAuthSession,
  getAuthSessionUser,
  revokeAuthSession,
  revokeUserSessions,
  updateAuthSessionSeen,
} from "./db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const scrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1 },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey))
    );
  });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function hashPassword(password: string) {
  if (password.length < 10)
    throw new Error("Пароль должен содержать минимум 10 символов");
  if (password.length > 256) throw new Error("Пароль слишком длинный");
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string | null | undefined
) {
  if (!encodedHash || password.length > 256) return false;
  const [algorithm, saltHex, hashHex] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"));
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

// Alphabet without look-alike characters (0/O, 1/l/I) so the password can be dictated or retyped safely.
const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const TEMPORARY_PASSWORD_TTL_MS = 1000 * 60 * 60 * 24 * 3;

/** One-time password for a new employee or an admin-initiated reset, e.g. "Xk7m-Pq4r-Tz9w". */
export function generateTemporaryPassword() {
  const groups = Array.from({ length: 3 }, () =>
    Array.from(
      { length: 4 },
      () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]
    ).join("")
  );
  return groups.join("-");
}

export const generateOpaqueToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const hashIp = (ip: string) =>
  createHash("sha256").update(`${ENV.sessionSecret}:${ip}`).digest("hex");
/** Client IP as resolved by Express ("trust proxy" is set to the single Railway proxy hop). */
export const requestIp = (req: Request) =>
  String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 64);

/**
 * A syntactically valid scrypt hash that matches no password. Login verifies against it when the
 * account does not exist, so response time does not reveal which e-mails are registered.
 */
export const DUMMY_PASSWORD_HASH = `scrypt$${randomBytes(16).toString("hex")}$${randomBytes(64).toString("hex")}`;

// Brute-force protection lives in ./security/rateLimit (database-backed, multi-instance safe).

export function getSessionToken(req: Request) {
  return parseCookie(req.headers.cookie ?? "")[COOKIE_NAME] || null;
}

export async function authenticateLocalRequest(req: Request) {
  const token = getSessionToken(req);
  if (!token) return null;
  const result = await getAuthSessionUser(hashToken(token));
  if (!result) return null;
  if (
    result.session.expiresAt.getTime() <= Date.now() ||
    result.session.revokedAt
  )
    return null;
  if (result.user.accountStatus !== "active") return null;
  // A session opened with a one-time password dies when that password expires unchanged.
  if (
    result.user.mustChangePassword &&
    result.user.temporaryPasswordExpiresAt &&
    new Date(result.user.temporaryPasswordExpiresAt).getTime() <= Date.now()
  )
    return null;
  // "Last seen" is refreshed at most every 5 minutes (not a write per request).
  if (Date.now() - new Date(result.session.lastSeenAt).getTime() > 5 * 60_000)
    await updateAuthSessionSeen(result.session.id);
  return result.user;
}

export async function establishSession(
  req: Request,
  res: Response,
  userId: number
) {
  const token = generateOpaqueToken();
  await createAuthSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: String(req.get("user-agent") ?? "").slice(0, 500) || null,
    ipHash: hashIp(requestIp(req)),
  });
  return { token, maxAge: SESSION_TTL_MS };
}

export async function revokeCurrentSession(req: Request) {
  const token = getSessionToken(req);
  if (token) await revokeAuthSession(hashToken(token));
}

export async function revokeAllUserSessions(userId: number) {
  await revokeUserSessions(userId);
}
