import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientIp, ipKey, isCloudflareIp } from "../src/clientip.js";

// SERBITO-361 (PKR-2/PKR-3): per-IP limits must key on the real visitor and must not
// trust headers a client can forge.

function req(headers: Record<string, string>, remoteAddress = "169.254.1.1"): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe("clientIp", () => {
  it("uses CF-Connecting-IP when the request arrived from a Cloudflare edge", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "203.0.113.7, 172.70.1.2", "cf-connecting-ip": "203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("ignores a forged CF-Connecting-IP on a request that bypassed Cloudflare", () => {
    expect(
      clientIp(req({ "x-forwarded-for": "198.51.100.9", "cf-connecting-ip": "1.1.1.1" })),
    ).toBe("198.51.100.9");
  });

  it("trusts only the last X-Forwarded-For hop (the one Google appended)", () => {
    expect(clientIp(req({ "x-forwarded-for": "10.9.9.9, 1.2.3.4, 198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });

  it("falls back to the socket address without headers", () => {
    expect(clientIp(req({}, "127.0.0.1"))).toBe("127.0.0.1");
    expect(clientIp(req({ "x-forwarded-for": "garbage" }, "127.0.0.1"))).toBe("127.0.0.1");
  });

  it("knows Cloudflare ranges", () => {
    expect(isCloudflareIp("172.70.1.2")).toBe(true);
    expect(isCloudflareIp("2606:4700::1")).toBe(true);
    expect(isCloudflareIp("198.51.100.9")).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
  });
});

describe("ipKey", () => {
  it("keys IPv4 as-is (also when IPv4-mapped)", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("keys IPv6 by its /64, however it is written", () => {
    expect(ipKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });
});
