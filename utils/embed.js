import { pipeline } from "@xenova/transformers";

let extractor = null;

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

export async function generateEmbedding(text) {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "none", normalize: false });
  return normalize(meanPooling(output));
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
