import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "vectors.json");

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

const STOP_WORDS_AR = [
  "في", "من", "إلى", "عن", "على", "مع", "كان", "هذا", "هذه", "ذلك",
  "تلك", "هو", "هي", "هم", "هن", "و", "ف", "ب", "ل", "ك", "لا", "ما",
  "لم", "لن", "إن", "أن", "قد", "كل", "بعض", "أو", "ثم", "حتى", "إذا",
  "عند", "بين", "تحت", "فوق", "خلال", "دون", "وال", "ال", "التي", "الذي",
  "الذين", "اللذان", "اللواتي", "به", "لها", "لهم", "له", "منها", "منهم",
  "عليها", "عليهم", "فيها", "فيهم", "وقد", "ولم", "ولا", "ومن", "عليه"
];

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\u0600-\u06FF\w\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS_AR.includes(t));
}

function buildInvertedIndex(store) {
  const index = {};
  for (const entry of store) {
    const tokens = tokenize(entry.text);
    const uniqueTokens = [...new Set(tokens)];
    for (const token of uniqueTokens) {
      if (!index[token]) index[token] = [];
      index[token].push(entry.id);
    }
  }
  return index;
}

function bm25Score(query, store) {
  const k1 = 1.5;
  const b = 0.75;
  const avgdl = store.reduce((sum, e) => sum + tokenize(e.text).length, 0) / (store.length || 1);

  const index = buildInvertedIndex(store);
  const N = store.length;
  const docLengths = store.map(e => tokenize(e.text).length);

  const scores = {};
  for (let i = 0; i < store.length; i++) scores[store[i].id] = 0;

  const queryTokens = [...new Set(tokenize(query))];
  for (const token of queryTokens) {
    const docsWithTerm = index[token] || [];
    const idf = Math.log((N - docsWithTerm.length + 0.5) / (docsWithTerm.length + 0.5) + 1);

    for (const docId of docsWithTerm) {
      const docIndex = store.findIndex(e => e.id === docId);
      if (docIndex === -1) continue;
      const tokens = tokenize(store[docIndex].text);
      const tf = tokens.filter(t => t === token).length;
      const docLen = docLengths[docIndex];
      scores[docId] += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgdl))));
    }
  }

  return scores;
}

export async function readStore() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeStore(data) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

export async function addChunks(chunks, embeddings) {
  const store = await readStore();
  const entries = chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    text: chunk.text,
    source: chunk.source,
    embedding: embeddings[i],
  }));
  store.push(...entries);
  await writeStore(store);
  return entries.length;
}

export async function clearStore() {
  await writeStore([]);
}

export function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}

export async function searchSimilar(queryEmbedding, topK = 5, queryText = "") {
  const store = await readStore();

  const denseScores = store.map((entry) => ({
    id: entry.id,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  const bm25Scores = queryText ? bm25Score(queryText, store) : {};

  const ALPHA = 0.7;

  const combined = store.map((entry, i) => {
    const dense = denseScores[i].score;
    const keyword = bm25Scores[entry.id] || 0;
    const maxBm25 = Math.max(...Object.values(bm25Scores), 1);
    const normalizedKeyword = maxBm25 > 0 ? keyword / maxBm25 : 0;
    return {
      ...entry,
      score: ALPHA * dense + (1 - ALPHA) * normalizedKeyword,
    };
  });

  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, topK);
}
