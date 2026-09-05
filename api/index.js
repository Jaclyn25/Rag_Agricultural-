import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.VERCEL) {
  const dataSource = path.join(__dirname, "..", "data");
  const dataTarget = path.join("/tmp", "zeraeh-data");
  process.env.ZERAEH_DATA_DIR = dataTarget;
  try {
    if (!fs.existsSync(dataTarget)) {
      fs.mkdirSync(dataTarget, { recursive: true });
      fs.cpSync(dataSource, dataTarget, { recursive: true });
    }
  } catch (err) {
    console.error("[vercel] data init failed:", err.message);
  }
}

export default async function handler(req, res) {
  const { app } = await import("../server/app.js");
  return app(req, res);
}
