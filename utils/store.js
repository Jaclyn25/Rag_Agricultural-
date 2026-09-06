import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { updateJsonFile, atomicWriteFile } from "./jsonfile.js";
import { tokenize } from "./text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ZERAEH_DATA_DIR || path.join(__dirname, "..", "data");
const VECTORS_FILE = path.join(DATA_DIR, "vectors.json");
const KNOWLEDGE_INDEX_FILE = path.join(DATA_DIR, "knowledge_index.json");
const FEEDBACK_FILE = path.join(DATA_DIR, "feedback.json");
const QA_KNOWLEDGE_FILE = path.join(DATA_DIR, "qa_knowledge.json");

function bm25Score(query, store) {
  const k1 = 1.5;
  const b = 0.75;
  const tokenizedDocs = store.map(e => tokenize(e.text));
  const avgdl = tokenizedDocs.reduce((sum, t) => sum + t.length, 0) / (store.length || 1);
  const index = {};
  for (let i = 0; i < store.length; i++) {
    for (const token of new Set(tokenizedDocs[i])) {
      if (!index[token]) index[token] = [];
      index[token].push(store[i].id);
    }
  }
  const idToIdx = new Map(store.map((e, i) => [e.id, i]));
  const N = store.length;
  const scores = {};
  for (let i = 0; i < store.length; i++) scores[store[i].id] = 0;
  const queryTokens = [...new Set(tokenize(query))];
  for (const token of queryTokens) {
    const docsWithTerm = index[token] || [];
    const idf = Math.log((N - docsWithTerm.length + 0.5) / (docsWithTerm.length + 0.5) + 1);
    for (const docId of docsWithTerm) {
      const docIndex = idToIdx.get(docId);
      if (docIndex === undefined) continue;
      const tokens = tokenizedDocs[docIndex];
      const tf = tokens.filter(t => t === token).length;
      const docLen = tokens.length;
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
  await atomicWriteFile(VECTORS_FILE, data);
}

export async function addChunks(chunks, embeddings, metadata = {}) {
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
  await updateJsonFile(VECTORS_FILE, [], (store) => {
    store.push(...entries);
    return store;
  });
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
  await updateJsonFile(VECTORS_FILE, [], (store) => store.filter(e => e.id !== id));
}

export async function deleteBySource(source) {
  await updateJsonFile(VECTORS_FILE, [], (store) => store.filter(e => e.source !== source));
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
  await atomicWriteFile(KNOWLEDGE_INDEX_FILE, index);
}

export async function addToKnowledgeIndex(entry) {
  await updateJsonFile(KNOWLEDGE_INDEX_FILE, [], (index) => {
    const existing = index.findIndex(e => e.filename === entry.filename);
    if (existing >= 0) {
      index[existing] = { ...index[existing], ...entry, updatedAt: Date.now() };
    } else {
      index.push({ ...entry, addedAt: Date.now(), updatedAt: Date.now() });
    }
    return index;
  });
}

export async function removeFromKnowledgeIndex(filename) {
  await updateJsonFile(KNOWLEDGE_INDEX_FILE, [], (index) => index.filter(e => e.filename !== filename));
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
  await atomicWriteFile(FEEDBACK_FILE, feedback);
}

export async function addFeedback(entry) {
  await updateJsonFile(FEEDBACK_FILE, [], (all) => {
    all.push({ ...entry, timestamp: Date.now() });
    return all;
  });
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
  await atomicWriteFile(QA_KNOWLEDGE_FILE, data);
}

export async function addQAKnowledge(entry) {
  const current = await getQAKnowledge();
  const existing = current.find(e => e.question === entry.question && e.answer === entry.answer);
  if (existing) return { entry: existing, created: false };
  const newEntry = {
    ...entry,
    id: crypto.randomUUID(),
    sourceType: "admin_qa",
    provenance: "user_qa",
    approved: true,
    createdAt: Date.now(),
    addedAt: Date.now(),
  };
  await updateJsonFile(QA_KNOWLEDGE_FILE, [], (all) => {
    all.push(newEntry);
    return all;
  });
  return { entry: newEntry, created: true };
}

export async function deleteQAKnowledge(id) {
  await updateJsonFile(QA_KNOWLEDGE_FILE, [], (all) => all.filter(e => e.id !== id));
}

export async function deleteChunksByTag(tag) {
  await updateJsonFile(VECTORS_FILE, [], (store) => store.filter(e => !(e.tags || []).includes(tag)));
}

export async function getStoreBySource(source) {
  const store = await readStore();
  return store.filter(e => e.source === source);
}
