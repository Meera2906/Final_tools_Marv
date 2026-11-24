/**
 * Base62 cryptographic slug generator with unbiased rejection sampling.
 * DESIGN.md §9.3
 */

import { isReservedSlug } from "./reserved";

const BASE62_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CHARSET_LENGTH = 62;
// 256 - (256 % 62) = 248. Discard values >= 248 to eliminate modulo bias.
const REJECTION_LIMIT = 248;

export class SlugCollisionError extends Error {
  constructor(message = "Maximum slug generation attempts exceeded") {
    super(message);
    this.name = "SlugCollisionError";
  }
}

/**
 * Generates an unbiased base62 slug of specified length using CSPRNG bytes.
 */
export function generateSlug(length = 7, rng?: (n: number) => Uint8Array): string {
  if (length <= 0) return "";

  const chars: string[] = [];
  const getBytes = rng ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));

  while (chars.length < length) {
    // Over-sample bytes to minimize CSPRNG calls while discarding >= 248
    const needed = (length - chars.length) * 2;
    const bytes = getBytes(Math.max(needed, 16));
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b !== undefined && b < REJECTION_LIMIT) {
        const char = BASE62_CHARSET[b % CHARSET_LENGTH];
        if (char !== undefined) {
          chars.push(char);
          if (chars.length === length) break;
        }
      }
    }
  }

  return chars.join("");
}

/**
 * Generates a unique slug that is neither taken in the database nor reserved.
 * Retries up to maxAttempts times before throwing SlugCollisionError.
 */
export async function generateUniqueSlug(
  isTaken: (code: string) => Promise<boolean> | boolean,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = generateSlug(7);

    // Skip reserved slugs
    if (isReservedSlug(candidate)) {
      continue;
    }

    // Check availability in database
    const taken = await isTaken(candidate);
    if (!taken) {
      return candidate;
    }
  }

  throw new SlugCollisionError();
}
