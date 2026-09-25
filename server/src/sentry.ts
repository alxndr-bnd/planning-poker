// Sentry error monitoring. Enabled only when SENTRY_DSN is set (prod: Secret Manager
// `planning-poker-sentry-dsn`, injected by the deploy workflow); a no-op otherwise, so
// local dev and tests never report. SENTRY_RELEASE comes from the git tag at deploy time.
import * as Sentry from "@sentry/node";

export function sentryOptions(
  env: NodeJS.ProcessEnv = process.env,
): Sentry.NodeOptions | null {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return null;
  return {
    dsn,
    release: env.SENTRY_RELEASE?.trim() || undefined,
    // K_SERVICE is set by Cloud Run on every instance.
    environment: env.K_SERVICE ? "production" : "development",
    // No PII. SDK v11 removed `sendDefaultPii` in favour of `dataCollection`, whose
    // defaults collect user info (IP), cookies, headers and bodies — so opt out
    // explicitly. Stack-frame locals are off too: they can hold participant names.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0.1,
    // The server ships as a single esbuild bundle with no node_modules, so the runtime
    // module-load hooks have nothing to patch (and can't be resolved). Errors, the
    // built-in node:http integration and process-level handlers work without them.
    enableRuntimeChannelInjection: false,
  };
}

/** Initialize Sentry if configured. Returns whether it was initialized. */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const options = sentryOptions(env);
  if (!options) return false;
  Sentry.init(options);
  return true;
}

/** Report a handled error (no-op when Sentry isn't initialized). */
export function reportError(err: unknown): void {
  Sentry.captureException(err);
}
