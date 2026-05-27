import { createPokerServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);

createPokerServer().listen(PORT, () => {
  console.log(`planning-poker server listening on :${PORT}`);
});
