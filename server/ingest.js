import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chunkText } from "../utils/chunker.js";
import { generateEmbeddings } from "../utils/embed.js";
import { addChunks, clearStore } from "../utils/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");

export async function ingestAll() {
  const files = await fs.readdir(KNOWLEDGE_DIR);
  const txtFiles = files.filter((f) => f.endsWith(".txt")).sort();
  let total = 0;

  await clearStore();

  for (const file of txtFiles) {
    const filePath = path.join(KNOWLEDGE_DIR, file);
    const text = await fs.readFile(filePath, "utf-8");
    const chunks = chunkText(text, file);
    const texts = chunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);
    const count = await addChunks(chunks, embeddings);
    total += count;
    console.log(`  ${file}: ${count} chunks`);
  }

  return total;
}
