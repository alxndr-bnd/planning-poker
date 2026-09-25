// Side-effect module: must be the FIRST import of the entrypoint so Sentry is
// initialized before the rest of the app is evaluated (ESM evaluates imports in order).
import { initSentry } from "./sentry.js";

initSentry();
