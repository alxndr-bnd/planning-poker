import { describe, it, expect, vi, beforeEach } from "vitest";

import { initSentry, sentryOptions, reportError } from "../src/sentry.js";

const { init, captureException } = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@sentry/node", () => ({ init, captureException }));

const DSN = "https://key@o1.ingest.us.sentry.io/2";

describe("sentry init", () => {
  beforeEach(() => {
    init.mockClear();
    captureException.mockClear();
  });

  it("does not initialize without SENTRY_DSN", () => {
    expect(initSentry({})).toBe(false);
    expect(initSentry({ SENTRY_DSN: "  ", K_SERVICE: "planning-poker" })).toBe(false);
    expect(init).not.toHaveBeenCalled();
    expect(sentryOptions({})).toBeNull();
  });

  it("initializes with release and production environment on Cloud Run", () => {
    expect(
      initSentry({
        SENTRY_DSN: DSN,
        SENTRY_RELEASE: "planning-poker@1.4.0",
        K_SERVICE: "planning-poker",
      }),
    ).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: DSN,
        release: "planning-poker@1.4.0",
        environment: "production",
        dataCollection: expect.objectContaining({
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
        }),
        tracesSampleRate: 0.1,
      }),
    );
  });

  it("uses the development environment and no release outside Cloud Run", () => {
    const opts = sentryOptions({ SENTRY_DSN: DSN });
    expect(opts?.environment).toBe("development");
    expect(opts?.release).toBeUndefined();
  });

  it("reportError forwards to Sentry.captureException", () => {
    const err = new Error("boom");
    reportError(err);
    expect(captureException).toHaveBeenCalledWith(err);
  });
});
