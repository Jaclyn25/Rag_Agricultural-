import { readStore, writeStore } from "../utils/store.js";
import { generateEmbedding } from "../utils/embed.js";

console.log("Re-embedding all stored chunks...\n");

const store = await readStore();
let updated = 0;

for (const entry of store) {
  entry.embedding = await generateEmbedding(entry.text);
  entry.version = (entry.version || 1) + 1;
  entry.ingestedAt = Date.now();
  updated++;
}

await writeStore(store);
console.log(`Done! ${updated} chunks re-embedded.`);
