import { describe, it, expect } from "vitest";
import { validateTargetUrl } from "@/lib/links/url-policy";

describe("url-policy: validateTargetUrl", () => {
  it("accepts valid http and https URLs", () => {
    const res = validateTargetUrl("https://example.com/some/path?query=1#hash");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.url).toBe("https://example.com/some/path?query=1#hash");
      expect(res.host).toBe("example.com");
      expect(res.flagPendingReview).toBe(false);
    }
  });

  it("normalizes default ports and strips trailing empty hash", () => {
    const res1 = validateTargetUrl("http://example.com:80/path#");
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      expect(res1.url).toBe("http://example.com/path");
    }

    const res2 = validateTargetUrl("https://example.com:443/");
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.url).toBe("https://example.com/");
    }
  });

  it("rejects non-string input or exceeding 2048 chars", () => {
    // @ts-expect-error testing invalid type
    expect(validateTargetUrl(null).ok).toBe(false);
    const longUrl = "https://example.com/" + "a".repeat(2040);
    expect(validateTargetUrl(longUrl).ok).toBe(false);
  });

  it("rejects control characters and whitespace", () => {
    expect(validateTargetUrl("https://example.com/path with space").ok).toBe(false);
    expect(validateTargetUrl("https://example.com/\x00malicious").ok).toBe(false);
    expect(validateTargetUrl(" https://example.com").ok).toBe(false);
    expect(validateTargetUrl("https://example.com\n").ok).toBe(false);
  });

  it("rejects forbidden schemes", () => {
    const badSchemes = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com",
      "vbscript:msgbox",
      "blob:https://example.com/uuid",
      "about:blank",
    ];
    for (const s of badSchemes) {
      const res = validateTargetUrl(s);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects embedded credentials", () => {
    expect(validateTargetUrl("https://user:pass@example.com").ok).toBe(false);
    expect(validateTargetUrl("https://user@example.com").ok).toBe(false);
  });

  it("rejects IP address hosts (IPv4, IPv6, loopback, private)", () => {
    const ipTargets = [
      "http://127.0.0.1",
      "http://127.0.0.2:8080/foo",
      "http://0.0.0.0",
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://192.168.1.1",
      "http://169.254.169.254",
      "http://8.8.8.8",
      "http://[::1]",
      "http://[fe80::1]",
      "http://[fc00::1]",
      "http://[::ffff:127.0.0.1]",
      // Alternative formats
      "http://2130706433", // 127.0.0.1 in decimal
      "http://0x7f000001", // 127.0.0.1 in hex
      "http://0177.0.0.1", // 127.0.0.1 in octal
    ];
    for (const target of ipTargets) {
      const res = validateTargetUrl(target);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects internal and local hostnames", () => {
    const internalHosts = [
      "http://localhost",
      "http://localhost:3000",
      "http://sub.localhost",
      "http://myhost.local",
      "http://service.internal",
      "http://metadata.google.internal",
    ];
    for (const target of internalHosts) {
      const res = validateTargetUrl(target);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects self-origin and /go/ loops", () => {
    const res1 = validateTargetUrl("https://marvedge.com/foo", {
      siteHost: "marvedge.com",
    });
    expect(res1.ok).toBe(false);

    const res2 = validateTargetUrl("https://marvedge.com/go/abc", {
      siteHost: "marvedge.com",
    });
    expect(res2.ok).toBe(false);

    const res3 = validateTargetUrl("https://marvedge.com/go/abc");
    expect(res3.ok).toBe(false);
  });

  it("blocks shortener chains when option enabled", () => {
    expect(validateTargetUrl("https://bit.ly/xyz", { blockShortenerChains: false }).ok).toBe(true);

    const res = validateTargetUrl("https://bit.ly/xyz", {
      blockShortenerChains: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("another link shortener");
    }

    expect(
      validateTargetUrl("https://sub.tinyurl.com/abc", {
        blockShortenerChains: true,
      }).ok,
    ).toBe(false);
  });

  it("flags punycode/IDN domains for review", () => {
    const res = validateTargetUrl("https://xn--e1afmkfd.xn--p1ai");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.flagPendingReview).toBe(true);
      expect(res.host).toContain("xn--");
    }
  });
});
