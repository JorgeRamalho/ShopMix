import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

const hashWithParams = (password, salt, n, r, p, keyLen) =>
  scryptSync(password, salt, keyLen, { N: n, r, p, maxmem: 64 * 1024 * 1024 });

export const hashPassword = (password) => {
  const salt = randomBytes(16);
  const hash = hashWithParams(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, KEY_LEN);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
};

export const verifyPassword = (stored, password) => {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 2 || r < 1 || p < 1) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;
  const actual = hashWithParams(String(password ?? ""), salt, n, r, p, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
};
