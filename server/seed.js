import { ingestAll } from "./ingest.js";

console.log("Ingesting agricultural knowledge base...\n");
const total = await ingestAll();
console.log(`\nDone! ${total} total chunks indexed.`);
