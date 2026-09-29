import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";

// Client IP for the per-IP limits (SERBITO-361 / PKR-2, PKR-3).
//
// Path in production: browser -> Cloudflare -> Google Front End (Cloud Run domain
// mapping) -> container. The container's socket peer is Google's proxy, so the real
// address comes from headers, and only the parts nobody upstream can forge count:
// - The Google Front End APPENDS the address it received the request from to
//   X-Forwarded-For, so the LAST entry is trustworthy; anything before it is
//   client-supplied.
// - When that address is a Cloudflare edge, Cloudflare's CF-Connecting-IP holds the
//   visitor. It is trusted ONLY then: a request sent straight to the *.run.app URL
//   comes from a non-Cloudflare address and its CF-Connecting-IP is ignored.
// Keying on the Cloudflare edge address instead would lump unrelated visitors together.

// https://www.cloudflare.com/ips/ (fetched 2026-09-29; the list changes rarely).
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const c of CLOUDFLARE_V4) {
  const [net, bits] = c.split("/");
  cloudflare.addSubnet(net, Number(bits), "ipv4");
}
for (const c of CLOUDFLARE_V6) {
  const [net, bits] = c.split("/");
  cloudflare.addSubnet(net, Number(bits), "ipv6");
}

export function isCloudflareIp(ip: string): boolean {
  const v = isIP(ip);
  if (!v) return false;
  return cloudflare.check(ip, v === 4 ? "ipv4" : "ipv6");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[v.length - 1] : v;
}

export function clientIp(req: IncomingMessage): string {
  const xff = header(req, "x-forwarded-for");
  const last = xff?.split(",").pop()?.trim();
  const peer = last && isIP(last) ? last : (req.socket.remoteAddress ?? "unknown");
  if (isCloudflareIp(peer)) {
    const visitor = header(req, "cf-connecting-ip")?.trim();
    if (visitor && isIP(visitor)) return visitor;
  }
  return peer;
}

/**
 * The key a per-IP limit counts under. IPv6 is keyed by its /64: one subscriber usually
 * gets a whole /64, so per-address counting would let one visitor use 2^64 "IPs".
 */
export function ipKey(ip: string): string {
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4mapped) return v4mapped[1];
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::")
    ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t]
    : h;
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
