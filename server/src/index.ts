import { createPokerServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);

// Last-resort guards so a stray async error logs instead of taking the instance down
// (the WS message handler already try/catches per-message; this is defense in depth).
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});

createPokerServer().listen(PORT, () => {
  console.log(`planning-poker server listening on :${PORT}`);
});
