import Groq from "groq-sdk";
import OpenAI from "openai";
import { generateEmbedding } from "../utils/embed.js";
import { searchSimilar, addQAKnowledge } from "../utils/store.js";
import dotenv from "dotenv";
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const SYSTEM_PROMPT = `أنت مساعد زراعي خبير اسمه "زراعة شات". أجب على أسئلة المستخدم بناءً فقط على المعلومات المتوفرة في السياق المقدم. اتبع هذه القواعد بدقة:

1. استخدم المعلومات من السياق فقط ولا تختلق معلومات.
2. اذكر اسم المصدر الذي استقيت منه المعلومة بين قوسين مربعين في نهاية كل معلومة مثل [المصدر: اسم الملف].
3. إذا لم تكن المعلومات كافية للإجابة، قل بصراحة: "عذراً، لا توجد معلومات كافية في قاعدة المعرفة للإجابة على هذا السؤال."
4. أجب باللغة العربية الفصحى الواضحة والمبسطة.
5. نظم إجابتك في فقرات قصيرة واضحة.
6. إذا سأل المستخدم عن موضوع خارج الزراعة، قل له أن تخصصك هو الإجابة على الأسئلة الزراعية فقط.`;

const HISTORY_SIZE = 6;

export async function askQuestion(question, history = [], options = {}) {
  const {
    model = "groq", alpha = 0.7, useHyde = false, useExpansion = false,
    useSelfRag = false, useMultiHop = false, useWebFallback = false, experimentId = null
  } = options;

  let queryText = question;
  if (useExpansion) queryText = await expandQuery(question);

  let results = [];
  if (useMultiHop) {
    results = await multiHopRetrieval(question);
  } else {
    let queryEmbedding = await generateEmbedding(queryText);
    results = await searchSimilar(queryEmbedding, 10, queryText, alpha);

    if (results.length > 0 && results[0].denseScore < 0.4) {
      const bm25Results = await searchSimilar(queryEmbedding, 10, queryText, 0.0);
      if (bm25Results.length > 0) results = bm25Results;
    }

    if (useHyde && results.length > 0) {
      const hydeResults = await hydeRetrieval(question);
      results = mergeResults(results, hydeResults).slice(0, 10);
    }
  }

  if (results.length === 0) {
    if (useWebFallback) {
      return await webFallbackRetrieval(question, history);
    }
    return { stream: null, noContext: true, experimentId };
  }

  const usedSources = [...new Set(results.map((r) => r.source))];
  const context = results
    .map((r) => `[المصدر: ${r.source}]\n${r.text}`)
    .join("\n\n---\n\n");

  const recentHistory = history.slice(-HISTORY_SIZE);
  const historyMessages = recentHistory.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  let stream;
  if (model === "openai" && openai) {
    stream = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...historyMessages,
        { role: "user", content: `السياق:\n${context}\n\nالسؤال: ${question}` },
      ],
      stream: true,
    });
  } else {
    stream = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...historyMessages,
        { role: "user", content: `السياق:\n${context}\n\nالسؤال: ${question}` },
      ],
      stream: true,
    });
  }

  return { stream, sources: usedSources, noContext: false, experimentId };
}

async function expandQuery(question) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "أنت مساعد لتحسين استعلامات البحث. أعد 3 صيغ مختلفة للسؤال المقدم في أسطر منفصلة. لا تكتب أي شيء غير الصيغ." },
        { role: "user", content: question },
      ],
    });
    const content = completion.choices[0]?.message?.content || "";
    const lines = content.split("\n").filter(l => l.trim()).slice(0, 3);
    return [question, ...lines].join(" ");
  } catch { return question; }
}

async function hydeRetrieval(question) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "اكتب فقرة قصيرة تجيب على السؤال الزراعي التالي بشكل دقيق وموجز." },
        { role: "user", content: question },
      ],
    });
    const hypoAns = completion.choices[0]?.message?.content || "";
    if (!hypoAns) return [];
    const embedding = await generateEmbedding(hypoAns);
    return await searchSimilar(embedding, 5, question, 0.6);
  } catch { return []; }
}

function mergeResults(r1, r2) {
  const seen = new Set();
  const merged = [];
  for (const r of [...r1, ...r2]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  return merged;
}

async function multiHopRetrieval(question) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "قسّم السؤال الزراعي التالي إلى 2-4 أسئلة فرعية. أعد كل سؤال في سطر واحد منفصل، لا شيء غيره." },
        { role: "user", content: `قسم السؤال: ${question}` },
      ],
    });
    const content = completion.choices[0]?.message?.content || "";
    const subQuestions = content.split("\n").filter(l => l.trim()).slice(0, 4);

    let allResults = [];
    const seen = new Set();

    for (const subQ of [question, ...subQuestions]) {
      const embedding = await generateEmbedding(subQ);
      const subResults = await searchSimilar(embedding, 4, subQ, 0.6);
      for (const r of subResults) {
        const key = `${r.id}-${subQ.slice(0, 20)}`;
        if (!seen.has(key)) {
          seen.add(key);
          r.score += 0.1; // boost for appearing in multiple hops
          allResults.push(r);
        }
      }
    }
    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, 10);
  } catch { return []; }
}

async function webFallbackRetrieval(question, history) {
  const recentHistory = history.slice(-HISTORY_SIZE);
  const historyMessages = recentHistory.map(m => ({ role: m.role, content: m.content }));

  const prompt = `Basandoti sulle tue conoscenze, rispondi alla seguente domanda in modo esaustivo. Indica chiaramente che la risposta è basata su conoscenze generali e non su una knowledge base specifica.\n\nDomanda: ${question}`;

  try {
    const stream = await groq.chat.completions.create({
      model: "llama-3.1-8b-basis",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        ...historyMessages,
        { role: "user", content: prompt },
      ],
      stream: true,
    });
    return { stream, sources: ["معرفة عامة"], noContext: false };
  } catch {
    return { stream: null, noContext: true };
  }
}
