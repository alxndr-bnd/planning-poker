// Optional analytics in the HTML pages (SERBITO-513). Every page has two marked blocks:
//
//   <!-- analytics:ga4 --> ... <!-- /analytics:ga4 -->               gtag.js, Consent Mode
//                                                                      default, consent.js
//   <!-- analytics:cloudflare --> ... <!-- /analytics:cloudflare -->  the CF Web Analytics beacon
//
// The build (client/vite.config.ts) fills a block with its id, or drops the block when the
// id is not set. A self-hosted copy built without GA_MEASUREMENT_ID / CF_BEACON_TOKEN loads
// no analytics and shows no cookie banner. The live site gets both from deploy.yml.

export interface PageAnalytics {
  /** GA4 measurement id, e.g. G-XXXXXXXXXX. Unset: no gtag.js, no cookie banner. */
  gaMeasurementId?: string;
  /** Cloudflare Web Analytics beacon token. Unset: no beacon. */
  cfBeaconToken?: string;
}

export const GA_PLACEHOLDER = "__GA_MEASUREMENT_ID__";
export const CF_BEACON_PLACEHOLDER = "__CF_BEACON_TOKEN__";

// The values go into HTML attributes and inline JS, so only the real formats pass.
const GA_ID_RE = /^G-[A-Z0-9]{4,20}$/;
const CF_TOKEN_RE = /^[0-9a-f]{32}$/;

/** The analytics config from build-time environment variables. Throws on a bad value. */
export function analyticsFromEnv(env: Record<string, string | undefined>): PageAnalytics {
  const out: PageAnalytics = {};
  const ga = env.GA_MEASUREMENT_ID?.trim();
  if (ga) {
    if (!GA_ID_RE.test(ga)) {
      throw new Error(`GA_MEASUREMENT_ID must look like G-XXXXXXXXXX, got ${JSON.stringify(ga)}`);
    }
    out.gaMeasurementId = ga;
  }
  const cf = env.CF_BEACON_TOKEN?.trim();
  if (cf) {
    if (!CF_TOKEN_RE.test(cf)) {
      throw new Error(`CF_BEACON_TOKEN must be 32 hex characters, got ${JSON.stringify(cf)}`);
    }
    out.cfBeaconToken = cf;
  }
  return out;
}

/** Fill the block `name` with `value`, or remove it (markers included) without a value. */
function block(html: string, name: string, placeholder: string, value?: string): string {
  const re = new RegExp(
    `[ \\t]*<!-- analytics:${name} -->\\r?\\n?([\\s\\S]*?)[ \\t]*<!-- /analytics:${name} -->\\r?\\n?`,
    "g",
  );
  return html.replace(re, (_m, body: string) => (value ? body.split(placeholder).join(value) : ""));
}

/** The page with its analytics blocks filled from `cfg` or removed. */
export function renderAnalytics(html: string, cfg: PageAnalytics): string {
  return block(
    block(html, "ga4", GA_PLACEHOLDER, cfg.gaMeasurementId),
    "cloudflare",
    CF_BEACON_PLACEHOLDER,
    cfg.cfBeaconToken,
  );
}
