import "./instrument.js"; // must stay first: initializes Sentry before the app loads
import { createPokerServer, parseAllowedOrigins } from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);

// Last-resort guards so a stray async error logs instead of taking the instance down
// (the WS message handler already try/catches per-message; this is defense in depth).
// Sentry's own process handlers (when enabled) also capture these; because these
// handlers exist, Sentry does not exit the process on an uncaught exception.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});

// SERBITO-513: a bad ALLOWED_ORIGINS stops the server here, before it takes traffic.
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

createPokerServer(undefined, { allowedOrigins }).listen(PORT, () => {
  console.log(`planning-poker server listening on :${PORT}`);
  // A self-hosted copy that forgot ALLOWED_ORIGINS sees why its rooms do not connect.
  console.log(`WebSocket accepted from: ${allowedOrigins.join(", ")} (ALLOWED_ORIGINS)`);
});
