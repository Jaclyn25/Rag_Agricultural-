import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const VECTORS_FILE = path.join(DATA_DIR, "vectors.json");
const KNOWLEDGE_INDEX_FILE = path.join(DATA_DIR, "knowledge_index.json");
const FEEDBACK_FILE = path.join(DATA_DIR, "feedback.json");
const QA_KNOWLEDGE_FILE = path.join(DATA_DIR, "qa_knowledge.json");

async function ensureDataDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
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
      const docLen = store[docIndex].text.split(/\s+/).length;
      scores[docId] += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgdl))));
    }
  }
  return scores;
}

export async function readStore() {
  try {
    const raw = await fs.readFile(VECTORS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeStore(data) {
  await ensureDataDir();
  await fs.writeFile(VECTORS_FILE, JSON.stringify(data, null, 2));
}

export async function addChunks(chunks, embeddings, metadata = {}) {
  const store = await readStore();
  const entries = chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    text: chunk.text,
    source: chunk.source,
    embedding: embeddings[i],
    category: chunk.category || metadata.category || "general",
    version: metadata.version || 1,
    language: metadata.language || "ar",
    ingestedAt: Date.now(),
    tags: chunk.tags || metadata.tags || [],
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

export async function searchSimilar(queryEmbedding, topK = 5, queryText = "", alpha = 0.7, filterSource = null) {
  const store = await readStore();
  const CONFIDENCE_THRESHOLD = 0.3;

  let filtered = store;
  if (filterSource) {
    filtered = store.filter(e => e.source === filterSource);
  }

  const denseScores = filtered.map((entry) => ({
    id: entry.id,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  const maxDense = Math.max(...denseScores.map(d => d.score), 0);

  const bm25Scores = queryText ? bm25Score(queryText, filtered) : {};
  const maxBm25 = Math.max(...Object.values(bm25Scores), 1);

  const combined = filtered.map((entry, i) => {
    const dense = denseScores[i].score;
    const keyword = bm25Scores[entry.id] || 0;
    const normalizedKeyword = maxBm25 > 0 ? keyword / maxBm25 : 0;

    let score;
    if (maxDense < CONFIDENCE_THRESHOLD && queryText) {
      score = normalizedKeyword;
    } else {
      score = alpha * dense + (1 - alpha) * normalizedKeyword;
    }

    return { ...entry, score, denseScore: dense, keywordScore: normalizedKeyword };
  });

  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, topK);
}

export async function deleteChunk(id) {
  const store = await readStore();
  const filtered = store.filter(e => e.id !== id);
  await writeStore(filtered);
}

export async function deleteBySource(source) {
  const store = await readStore();
  const filtered = store.filter(e => e.source !== source);
  await writeStore(filtered);
}

export async function getStoreStats() {
  const store = await readStore();
  const sources = {};
  for (const e of store) {
    sources[e.source] = (sources[e.source] || 0) + 1;
  }
  return {
    totalChunks: store.length,
    totalSources: Object.keys(sources).length,
    sources,
    lastUpdated: store.length > 0 ? Math.max(...store.map(e => e.ingestedAt || 0)) : null,
  };
}

export async function getKnowledgeIndex() {
  try {
    const raw = await fs.readFile(KNOWLEDGE_INDEX_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveKnowledgeIndex(index) {
  await ensureDataDir();
  await fs.writeFile(KNOWLEDGE_INDEX_FILE, JSON.stringify(index, null, 2));
}

export async function addToKnowledgeIndex(entry) {
  const index = await getKnowledgeIndex();
  const existing = index.findIndex(e => e.filename === entry.filename);
  if (existing >= 0) {
    index[existing] = { ...index[existing], ...entry, updatedAt: Date.now() };
  } else {
    index.push({ ...entry, addedAt: Date.now(), updatedAt: Date.now() });
  }
  await saveKnowledgeIndex(index);
}

export async function removeFromKnowledgeIndex(filename) {
  const index = await getKnowledgeIndex();
  const filtered = index.filter(e => e.filename !== filename);
  await saveKnowledgeIndex(filtered);
}

export async function getFeedback() {
  try {
    const raw = await fs.readFile(FEEDBACK_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveFeedback(feedback) {
  await ensureDataDir();
  await fs.writeFile(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
}

export async function addFeedback(entry) {
  const all = await getFeedback();
  all.push({ ...entry, timestamp: Date.now() });
  await saveFeedback(all);
}

export async function getQAKnowledge() {
  try {
    const raw = await fs.readFile(QA_KNOWLEDGE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveQAKnowledge(data) {
  await ensureDataDir();
  await fs.writeFile(QA_KNOWLEDGE_FILE, JSON.stringify(data, null, 2));
}

export async function addQAKnowledge(entry) {
  const all = await getQAKnowledge();
  all.push({ ...entry, id: crypto.randomUUID(), addedAt: Date.now() });
  await saveQAKnowledge(all);
}

export async function getStoreBySource(source) {
  const store = await readStore();
  return store.filter(e => e.source === source);
}
