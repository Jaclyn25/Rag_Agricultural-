import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { generateEmbedding } from "../utils/embed.js";
import { searchSimilar, readStore } from "../utils/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_FILE = path.join(__dirname, "..", "data", "eval_dataset.json");
const RESULTS_FILE = path.join(__dirname, "..", "data", "eval_results.json");

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

function kwMatch(texts, keywords) {
  if (keywords.length === 0) return 1;
  const combined = texts.join(" ").toLowerCase();
  return keywords.filter(k => combined.includes(k)).length / keywords.length;
}

function mrrs(scores) {
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

async function runEval() {
  const raw = await fs.readFile(EVAL_FILE, "utf-8");
  const dataset = JSON.parse(raw);
  const store = await readStore();

  console.log(`\n📊 Evaluating ${dataset.length} queries against ${store.length} chunks\n`);

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
      let totalRecall = 0, totalPrecision = 0, totalKw = 0;
      let passes = 0, fails = 0;

      for (const item of dataset) {
        const embedding = await generateEmbedding(item.question);
        const retrieved = await searchSimilar(embedding, k, item.question, config.alpha);
        const sources = [...new Set(retrieved.map(r => r.source))];
        const texts = retrieved.map(r => r.text);

        const r = recall(sources, item.expectedSources);
        const p = precision(sources, item.expectedSources);
        const kw = kwMatch(texts, item.expectedKeywords);

        totalRecall += r;
        totalPrecision += p;
        totalKw += kw;

        if (r > 0) passes++; else fails++;
      }

      const avgRecall = totalRecall / dataset.length;
      const avgPrecision = totalPrecision / dataset.length;
      const avgF1 = f1(avgRecall, avgPrecision);
      const avgKw = totalKw / dataset.length;
      const passRate = passes / dataset.length;

      allResults.push({
        alpha: config.alpha,
        topK: k,
        config: config.name,
        avgRecall: +(avgRecall * 100).toFixed(1),
        avgPrecision: +(avgPrecision * 100).toFixed(1),
        avgF1: +(avgF1 * 100).toFixed(1),
        avgKeywordMatch: +(avgKw * 100).toFixed(1),
        passRate: +(passRate * 100).toFixed(1),
        passes,
        fails,
      });

      console.log(
        `  topK=${k}: recall=${(avgRecall*100).toFixed(0)}% ` +
        `precision=${(avgPrecision*100).toFixed(0)}% ` +
        `f1=${(avgF1*100).toFixed(0)}% ` +
        `kw=${(avgKw*100).toFixed(0)}% ` +
        `pass=${passes}/${dataset.length}`
      );
    }
  }

  allResults.sort((a, b) => b.avgF1 - a.avgF1);
  const best = allResults[0];

  console.log(`\n🏆 Best config: alpha=${best.alpha}, topK=${best.topK} (${best.config})`);
  console.log(`   F1=${best.avgF1}% | Recall=${best.avgRecall}% | Precision=${best.avgPrecision}% | PassRate=${best.passRate}%\n`);

  await fs.writeFile(RESULTS_FILE, JSON.stringify({ best, all: allResults, timestamp: Date.now() }, null, 2));
  console.log(`📝 Results saved to data/eval_results.json`);
}

await runEval();
