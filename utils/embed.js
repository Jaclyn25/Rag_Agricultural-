import { pipeline } from "@xenova/transformers";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "data", "embed_cache");
const CACHE_FILE = path.join(CACHE_DIR, "cache.json");

let extractor = null;
let embedCache = null;
let cacheDirty = false;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

function meanPooling(output) {
  const { data, dims } = output;
  const [, seqLen, featDim] = dims;
  const result = new Array(featDim).fill(0);
  for (let s = 0; s < seqLen; s++) {
    for (let f = 0; f < featDim; f++) {
      result[f] += data[s * featDim + f];
    }
  }
  return result.map((v) => v / seqLen);
}

function normalize(vec) {
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return mag ? vec.map(v => v / mag) : vec;
}

async function loadCache() {
  if (embedCache !== null) return;
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    embedCache = JSON.parse(raw);
  } catch {
    embedCache = {};
  }
}

async function saveCache() {
  if (!cacheDirty) return;
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(embedCache));
    cacheDirty = false;
  } catch {}
}

function getCacheKey(text) {
  return text.slice(0, 100) + ":" + text.length;
}

export async function generateEmbedding(text) {
  await loadCache();
  const key = getCacheKey(text);
  if (embedCache[key]) return embedCache[key];

  const ext = await getExtractor();
  const output = await ext(text, { pooling: "none", normalize: false });
  const vec = normalize(meanPooling(output));
  embedCache[key] = vec;
  cacheDirty = true;
  saveCache();
  return vec;
}

export async function generateEmbeddings(texts) {
  const ext = await getExtractor();
  const results = [];
  for (const text of texts) {
    const output = await ext(text, { pooling: "none", normalize: false });
    results.push(normalize(meanPooling(output)));
  }
  return results;
}
