/**
 * PBKDF2-SHA256 password hashing with constant-time verification.
 * DESIGN.md §10.3
 */

import { timingSafeEqual } from "node:crypto";

export const DEFAULT_ITERATIONS = 300_000;
const LEGACY_ITERATIONS = 100_000;
const SALT_BYTE_LENGTH = 16;
const HASH_BIT_LENGTH = 256;

const encoder = new TextEncoder();

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(hexA: string, hexB: string): boolean {
  if (typeof hexA !== "string" || typeof hexB !== "string") return false;
  const bufA = Buffer.from(hexA, "hex");
  const bufB = Buffer.from(hexB, "hex");
  if (bufA.length === 0 || bufB.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

async function derivePbkdf2Hex(pw: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pw), "PBKDF2", false, [
    "deriveBits",
  ]);

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as ArrayBufferView<ArrayBuffer>,
      iterations,
      hash: "SHA-256",
    },
    key,
    HASH_BIT_LENGTH,
  );

  return bufferToHex(bits);
}

/**
 * Hashes a plaintext password using PBKDF2-SHA256 with 300,000 iterations and 16-byte random salt.
 * Output format: pbkdf2$sha256$<iters>$<saltHex>$<hashHex>
 */
export async function hashPassword(
  pw: string,
  saltBytes?: Uint8Array,
  iterations = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = saltBytes ?? crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const saltHex = bufferToHex(salt.buffer as ArrayBuffer);
  const hashHex = await derivePbkdf2Hex(pw, salt, iterations);

  return `pbkdf2$sha256$${iterations}$${saltHex}$${hashHex}`;
}

export interface VerifyPasswordResult {
  ok: boolean;
  needsUpgrade: boolean;
}

/**
 * Verifies a password against a stored hash in constant time.
 * Supports current format `pbkdf2$sha256$...` and legacy `saltHex:hashHex`.
 * Never throws on malformed input.
 */
export async function verifyPassword(pw: string, stored: string): Promise<VerifyPasswordResult> {
  if (typeof pw !== "string" || typeof stored !== "string" || stored.length === 0) {
    return { ok: false, needsUpgrade: false };
  }

  try {
    // 1. Check legacy format: <saltHex32>:<hashHex64>
    if (stored.includes(":") && !stored.includes("$")) {
      const parts = stored.split(":");
      const p0 = parts[0];
      const p1 = parts[1];
      if (parts.length === 2 && p0 && p1 && p0.length === 32 && p1.length === 64) {
        const salt = hexToBytes(p0);
        if (!salt) return { ok: false, needsUpgrade: false };

        const computed = await derivePbkdf2Hex(pw, salt, LEGACY_ITERATIONS);
        const matches = constantTimeEqual(computed, p1);
        return {
          ok: matches,
          needsUpgrade: matches, // Always needs upgrade from legacy
        };
      }
      return { ok: false, needsUpgrade: false };
    }

    // 2. Check standard format: pbkdf2$sha256$<iters>$<saltHex>$<hashHex>
    const match = stored.match(/^pbkdf2\$sha256\$(\d+)\$([0-9a-fA-F]{32})\$([0-9a-fA-F]{64})$/);
    const m1 = match?.[1];
    const m2 = match?.[2];
    const m3 = match?.[3];
    if (!m1 || !m2 || !m3) {
      return { ok: false, needsUpgrade: false };
    }

    const iters = parseInt(m1, 10);
    const saltHex = m2;
    const expectedHashHex = m3;

    if (iters <= 0) return { ok: false, needsUpgrade: false };
    const salt = hexToBytes(saltHex);
    if (!salt) return { ok: false, needsUpgrade: false };

    const computed = await derivePbkdf2Hex(pw, salt, iters);
    const matches = constantTimeEqual(computed, expectedHashHex);

    return {
      ok: matches,
      needsUpgrade: matches && iters < DEFAULT_ITERATIONS,
    };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
}
