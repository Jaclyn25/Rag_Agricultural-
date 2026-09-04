import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chunkText } from "../utils/chunker.js";
import { generateEmbeddings } from "../utils/embed.js";
import { addChunks, clearStore, addToKnowledgeIndex, removeFromKnowledgeIndex, getQAKnowledge } from "../utils/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = process.env.ZERAEH_KNOWLEDGE_DIR || path.join(__dirname, "..", "knowledge");

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
    await addToKnowledgeIndex({ filename: file, chunkCount: count, size: Buffer.byteLength(text, "utf8") });
    total += count;
    console.log(`  ${file}: ${count} chunks`);
  }

  const qaEntries = await getQAKnowledge();
  for (const qa of qaEntries) {
    if (qa.approved === false) continue;
    const text = `سؤال: ${qa.question}\nجواب: ${qa.answer}`;
    const embeddings = await generateEmbeddings([text]);
    const count = await addChunks([{ text, source: "user_qa" }], embeddings, {
      category: "user_qa",
      tags: [`qa:${qa.id}`, "user_qa"],
    });
    total += count;
    console.log(`  user_qa (${qa.id}): ${count} chunk`);
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
