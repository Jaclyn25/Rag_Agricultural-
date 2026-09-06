import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`زراعة شات RAG running at http://0.0.0.0:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      console.log("Server closed.");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
