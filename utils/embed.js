import { pipeline } from "@xenova/transformers";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "node:crypto";
import { updateJsonFile, readJson } from "./jsonfile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ZERAEH_DATA_DIR || path.join(__dirname, "..", "data");
const CACHE_DIR = path.join(DATA_DIR, "embed_cache");
const CACHE_FILE = path.join(CACHE_DIR, "cache.json");
const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const CACHE_MAX_ENTRIES = 20000;

let extractor = null;
let embedCache = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID);
  }
  return extractor;
}

export function buildCacheKey(text, modelId = EMBEDDING_MODEL_ID) {
  return createHash("sha256").update(`${modelId}\n${text}`).digest("hex");
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
  embedCache = await readJson(CACHE_FILE, {});
}

export async function generateEmbedding(text) {
  await loadCache();
  const key = buildCacheKey(text);
  if (embedCache[key]) return embedCache[key];

  const ext = await getExtractor();
  const output = await ext(text, { pooling: "none", normalize: false });
  const vec = normalize(meanPooling(output));
  embedCache[key] = vec;
  await updateJsonFile(CACHE_FILE, {}, (cache) => {
    cache[key] = vec;
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX_ENTRIES) {
      for (let i = 0; i < keys.length - CACHE_MAX_ENTRIES; i++) delete cache[keys[i]];
    }
    return cache;
  });
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
