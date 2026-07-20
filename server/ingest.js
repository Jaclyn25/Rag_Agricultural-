import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chunkText } from "../utils/chunker.js";
import { generateEmbeddings } from "../utils/embed.js";
import { addChunks, clearStore, addToKnowledgeIndex, removeFromKnowledgeIndex } from "../utils/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge");

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".html", ".json"];

export async function ingestAll() {
  const files = await fs.readdir(KNOWLEDGE_DIR);
  const supportedFiles = files.filter(f => SUPPORTED_EXTENSIONS.some(ext => f.endsWith(ext))).sort();
  let total = 0;

  await clearStore();

  for (const file of supportedFiles) {
    const filePath = path.join(KNOWLEDGE_DIR, file);
    const text = await readFileContent(filePath, file);
    if (!text) continue;
    const chunks = chunkText(text, file);
    const texts = chunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);
    const count = await addChunks(chunks, embeddings, { version: 1, language: "ar" });
    await addToKnowledgeIndex({ filename: file, chunkCount: count, size: text.length });
    total += count;
    console.log(`  ${file}: ${count} chunks`);
  }
  return total;
}

async function readFileContent(filePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  const text = await fs.readFile(filePath, "utf-8");

  if (ext === ".html") {
    return text.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  }
  if (ext === ".md" || ext === ".txt") {
    return text;
  }
  return text;
}
