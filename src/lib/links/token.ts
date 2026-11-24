/**
 * Creator token generation, hashing, and constant-time verification.
 * DESIGN.md §10.4
 */

import { createHash, timingSafeEqual } from "node:crypto";

export interface CreatorTokenPair {
  token: string;
  hash: string;
}

/**
 * Generates a 32-byte CSPRNG token (base64url) and its SHA-256 hex digest.
 */
export function generateCreatorToken(): CreatorTokenPair {
  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Buffer.from(rawBytes).toString("base64url");
  const hash = createHash("sha256").update(rawBytes).digest("hex");
  return { token, hash };
}

/**
 * Decodes a base64url token strictly (must decode to exactly 32 bytes)
 * and returns its lowercase 64-character SHA-256 hex digest.
 * Returns null if malformed or length is invalid.
 */
export function hashCreatorToken(token: string): string | null {
  if (typeof token !== "string" || token.length !== 43) {
    return null;
  }

  // Base64url characters only
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }

  const rawBytes = Buffer.from(token, "base64url");
  if (rawBytes.length !== 32) {
    return null;
  }

  // Strict check: re-encoded must equal original token (reject non-canonical base64 padding bits)
  if (rawBytes.toString("base64url") !== token) {
    return null;
  }

  return createHash("sha256").update(rawBytes).digest("hex");
}

/**
 * Constant-time verification of a creator token against the stored SHA-256 hash.
 * Returns false if storedHash is null, undefined, or invalid hex length.
 */
export function verifyCreatorToken(token: string, storedHash: string | null | undefined): boolean {
  if (
    !storedHash ||
    typeof storedHash !== "string" ||
    storedHash.length !== 64 ||
    !/^[0-9a-fA-F]{64}$/.test(storedHash)
  ) {
    return false;
  }

  const computedHash = hashCreatorToken(token);
  if (!computedHash) {
    return false;
  }

  const bufA = Buffer.from(computedHash, "hex");
  const bufB = Buffer.from(storedHash, "hex");

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
