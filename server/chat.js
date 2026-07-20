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
const ALPHA = 0.7;

export async function askQuestion(question, history = [], options = {}) {
  const { model = "groq", alpha = ALPHA, useHyde = false, useExpansion = false, useSelfRag = false } = options;

  let queryText = question;

  if (useExpansion) {
    queryText = await expandQuery(question);
  }

  let queryEmbedding = await generateEmbedding(queryText);
  let results = await searchSimilar(queryEmbedding, 10, queryText, alpha);

  if (useHyde && results.length > 0) {
    const hydeResults = await hydeRetrieval(question);
    const merged = mergeResults(results, hydeResults);
    results = merged.slice(0, 10);
  }

  if (results.length === 0) {
    return { stream: null, noContext: true };
  }

  const context = results
    .map((r) => `[المصدر: ${r.source}]\n${r.text}`)
    .join("\n\n---\n\n");

  const sources = [...new Set(results.map((r) => r.source))];

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

  return { stream, sources, noContext: false };
}

async function expandQuery(question) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "قم بتوليد 3 صيغ مختلفة لنفس السؤال الزراعي لتحسين البحث. أعد كل صيغة في سطر منفصل." },
        { role: "user", content: question },
      ],
    });
    const expanded = completion.choices[0]?.message?.content || "";
    const lines = expanded.split("\n").filter(l => l.trim()).slice(0, 3);
    return [question, ...lines].join(" ");
  } catch {
    return question;
  }
}

async function hydeRetrieval(question) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: "اكتب فقرة قصيرة تجيب على السؤال الزراعي التالي كما لو كنت خبيراً:" },
        { role: "user", content: question },
      ],
    });
    const hypotheticalAnswer = completion.choices[0]?.message?.content || "";
    if (!hypotheticalAnswer) return [];
    const hydeEmbedding = await generateEmbedding(hypotheticalAnswer);
    return await searchSimilar(hydeEmbedding, 5, question, ALPHA);
  } catch {
    return [];
  }
}

function mergeResults(results1, results2) {
  const seen = new Set();
  const merged = [];
  for (const r of [...results1, ...results2]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  return merged;
}
