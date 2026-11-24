import { describe, it, expect } from "vitest";
import { isBlockedHost, noopReputationProvider } from "@/lib/links/blocklist";

describe("blocklist: isBlockedHost & noopReputationProvider", () => {
  const blockedList = ["evil.com", "phishing.test.", "MALWARE.net"];

  it("identifies exact domain matches regardless of casing or trailing dots", () => {
    expect(isBlockedHost("evil.com", blockedList)).toBe(true);
    expect(isBlockedHost("EVIL.COM", blockedList)).toBe(true);
    expect(isBlockedHost("evil.com.", blockedList)).toBe(true);
    expect(isBlockedHost("phishing.test", blockedList)).toBe(true);
    expect(isBlockedHost("malware.net", blockedList)).toBe(true);
  });

  it("identifies parent-domain subdomain matches", () => {
    expect(isBlockedHost("a.evil.com", blockedList)).toBe(true);
    expect(isBlockedHost("deep.sub.evil.com", blockedList)).toBe(true);
    expect(isBlockedHost("login.phishing.test", blockedList)).toBe(true);
  });

  it("does NOT match partial string collisions", () => {
    expect(isBlockedHost("notevil.com", blockedList)).toBe(false);
    expect(isBlockedHost("evil.community", blockedList)).toBe(false);
    expect(isBlockedHost("myphishing.test", blockedList)).toBe(false);
    expect(isBlockedHost("goodsite.com", blockedList)).toBe(false);
  });

  it("handles empty or malformed inputs safely", () => {
    expect(isBlockedHost("", blockedList)).toBe(false);
    // @ts-expect-error non-string
    expect(isBlockedHost(null, blockedList)).toBe(false);
    expect(isBlockedHost("evil.com", [])).toBe(false);
  });

  it("noopReputationProvider returns safe: true", async () => {
    const res = await noopReputationProvider.check("https://example.com");
    expect(res.safe).toBe(true);
  });
});
