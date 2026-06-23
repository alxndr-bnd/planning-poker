import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Billing defence (2026-06-23): stale browser tabs running pre-v2 client JS connect to
// bare /ws and blindly auto-reconnect, pinning the Cloud Run instance 24/7 (no
// scale-to-zero) — and a server-side fix can't stop a client that ignores close codes.
// The fix is an EDGE gate: the live client tags its socket with ?v=2 and a Cloudflare
// WAF rule blocks /ws WITHOUT that marker, so stale tabs are dropped before they reach
// the origin. If this marker is ever removed, the CF rule would block the LIVE client
// too — so guard that the version-gate stays in the WS URL.

const __dirname = dirname(fileURLToPath(import.meta.url));
const wsSrc = readFileSync(
  join(__dirname, "../../client/src/ws.ts"),
  "utf-8",
);

describe("WS version-gate (?v=2)", () => {
  it("the client connects to /ws with the ?v=2 edge-gate marker", () => {
    expect(wsSrc).toMatch(/\$\{WS_PATH\}\?v=2/);
  });
});
