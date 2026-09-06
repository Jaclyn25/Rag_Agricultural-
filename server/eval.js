import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { generateEmbedding } from "../utils/embed.js";
import { searchSimilar, readStore } from "../utils/store.js";
import { tokenize } from "../utils/text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_FILE = path.join(__dirname, "..", "data", "eval_dataset.json");
const RESULTS_FILE = path.join(__dirname, "..", "data", "eval_results.json");
const LOW_CONFIDENCE_THRESHOLD = 0.4;

function recall(retrieved, expected) {
  if (expected.length === 0) return 1;
  return expected.filter(s => retrieved.includes(s)).length / expected.length;
}

function precision(retrieved, expected) {
  if (retrieved.length === 0) return 0;
  return retrieved.filter(s => expected.includes(s)).length / retrieved.length;
}

function f1(r, p) {
  return r + p > 0 ? 2 * r * p / (r + p) : 0;
}

function mrr(retrieved, expected) {
  if (expected.length === 0) return 0;
  const idx = retrieved.findIndex(s => expected.includes(s));
  return idx >= 0 ? 1 / (idx + 1) : 0;
}

function kwMatch(texts, keywords) {
  if (keywords.length === 0) return 1;
  const docTokens = new Set();
  for (const t of texts) {
    for (const tok of tokenize(t)) docTokens.add(tok);
  }
  let hits = 0;
  for (const kw of keywords) {
    const kwTokens = tokenize(kw);
    if (kwTokens.length === 0) {
      hits++;
      continue;
    }
    if (kwTokens.every(t => docTokens.has(t))) hits++;
  }
  return hits / keywords.length;
}

async function runEval() {
  const raw = await fs.readFile(EVAL_FILE, "utf-8");
  const dataset = JSON.parse(raw);
  const store = await readStore();

  const retrievalItems = dataset.filter(i => !i.outOfDomain && !i.adversarial);
  const oodItems = dataset.filter(i => i.outOfDomain || i.adversarial);

  console.log(`\n📊 Evaluating ${dataset.length} queries (${retrievalItems.length} retrieval, ${oodItems.length} OOD/adversarial) against ${store.length} chunks\n`);

  const alphaConfigs = [
    { alpha: 0.3, name: "BM25-heavy" },
    { alpha: 0.5, name: "Balanced" },
    { alpha: 0.7, name: "Dense-heavy" },
    { alpha: 1.0, name: "Dense-only" },
  ];
  const topKs = [3, 5, 10];
  const allResults = [];

  for (const config of alphaConfigs) {
    console.log(`\n─── Alpha=${config.alpha} (${config.name}) ───`);
    for (const k of topKs) {
      let totalRecall = 0, totalPrecision = 0, totalKw = 0, totalMrr = 0;
      let totalExpectedSources = 0, totalHitSources = 0;
      let passes = 0, fails = 0;

      for (const item of retrievalItems) {
        const embedding = await generateEmbedding(item.question);
        const retrieved = await searchSimilar(embedding, k, item.question, config.alpha);
        const sources = [...new Set(retrieved.map(r => r.source))];
        const texts = retrieved.map(r => r.text);

        const r = recall(sources, item.expectedSources);
        const p = precision(sources, item.expectedSources);
        const kw = kwMatch(texts, item.expectedKeywords);
        const m = mrr(sources, item.expectedSources);

        totalRecall += r;
        totalPrecision += p;
        totalKw += kw;
        totalMrr += m;
        totalExpectedSources += item.expectedSources.length;
        totalHitSources += item.expectedSources.filter(s => sources.includes(s)).length;

        if (r > 0) passes++; else fails++;
      }

      const n = retrievalItems.length;
      const avgRecall = totalRecall / n;
      const avgPrecision = totalPrecision / n;
      const avgF1 = f1(avgRecall, avgPrecision);
      const avgKw = totalKw / n;
      const avgMrr = totalMrr / n;
      const sourceHitRate = totalExpectedSources > 0 ? totalHitSources / totalExpectedSources : 0;

      allResults.push({
        alpha: config.alpha,
        topK: k,
        config: config.name,
        avgRecall: +(avgRecall * 100).toFixed(1),
        avgPrecision: +(avgPrecision * 100).toFixed(1),
        avgF1: +(avgF1 * 100).toFixed(1),
        avgKeywordMatch: +(avgKw * 100).toFixed(1),
        avgMRR: +(avgMrr * 100).toFixed(1),
        sourceHitRate: +(sourceHitRate * 100).toFixed(1),
        passRate: +((passes / n) * 100).toFixed(1),
        passes,
        fails,
      });

      console.log(
        `  topK=${k}: recall=${(avgRecall*100).toFixed(0)}% ` +
        `precision=${(avgPrecision*100).toFixed(0)}% ` +
        `f1=${(avgF1*100).toFixed(0)}% ` +
        `mrr=${(avgMrr*100).toFixed(0)}% ` +
        `srcHit=${(sourceHitRate*100).toFixed(0)}% ` +
        `kw=${(avgKw*100).toFixed(0)}% ` +
        `pass=${passes}/${n}`
      );
    }
  }

  let rejected = 0;
  let sumTopDense = 0;
  const oodPerItem = [];
  for (const item of oodItems) {
    const embedding = await generateEmbedding(item.question);
    const retrieved = await searchSimilar(embedding, 10, item.question, 0.7);
    const topDense = retrieved.length > 0 ? retrieved[0].denseScore : 0;
    const isRejected = topDense < LOW_CONFIDENCE_THRESHOLD;
    if (isRejected) rejected++;
    sumTopDense += topDense;
    oodPerItem.push({ id: item.id, topDenseScore: +topDense.toFixed(3), rejected: isRejected });
  }
  const oodCount = oodItems.length;
  const rejectionAccuracy = oodCount > 0 ? rejected / oodCount : 0;
  const avgTopDense = oodCount > 0 ? sumTopDense / oodCount : 0;
  console.log(`\n─── Out-of-domain / adversarial ───`);
  console.log(`  rejectionAccuracy=${(rejectionAccuracy*100).toFixed(0)}% (top dense < ${LOW_CONFIDENCE_THRESHOLD})`);
  console.log(`  avgTopDenseScore=${avgTopDense.toFixed(3)}`);

  if (allResults.length === 0) {
    console.error("No evaluation results produced (empty dataset?)");
    process.exit(1);
  }

  const best = [...allResults].sort((a, b) => b.avgF1 - a.avgF1)[0];
  const bestK = best.topK;

  const perQuestion = [];
  for (const item of retrievalItems) {
    const embedding = await generateEmbedding(item.question);
    const retrieved = await searchSimilar(embedding, bestK, item.question, best.alpha);
    const sources = [...new Set(retrieved.map(r => r.source))];
    perQuestion.push({
      id: item.id,
      category: item.category,
      question: item.question,
      expectedSources: item.expectedSources,
      retrievedSources: sources,
      success: item.expectedSources.every(s => sources.includes(s)),
      mrr: +mrr(sources, item.expectedSources).toFixed(3),
    });
  }

  console.log(`\n🏆 Best config: alpha=${best.alpha}, topK=${best.topK} (${best.config})`);
  console.log(`   F1=${best.avgF1}% | Recall=${best.avgRecall}% | Precision=${best.avgPrecision}% | MRR=${best.avgMRR}% | SourceHit=${best.sourceHitRate}% | PassRate=${best.passRate}%\n`);

  const result = {
    timestamp: Date.now(),
    datasetSize: dataset.length,
    retrievalCount: retrievalItems.length,
    oodCount,
    methodology: "retrieval-only; token-aware keyword match; MRR@K; OOD rejection = top dense < 0.4; citations validated separately (unit-tested)",
    best,
    all: allResults,
    ood: { rejectionAccuracy: +(rejectionAccuracy * 100).toFixed(1), avgTopDenseScore: +avgTopDense.toFixed(3), perItem: oodPerItem },
    perQuestion,
  };

  await fs.writeFile(RESULTS_FILE, JSON.stringify(result, null, 2));
  console.log(`📝 Results saved to data/eval_results.json`);
}

await runEval();
