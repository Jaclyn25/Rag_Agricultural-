import Groq from "groq-sdk";
import { generateEmbedding } from "../utils/embed.js";
import { searchSimilar } from "../utils/store.js";
import dotenv from "dotenv";
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `أنت مساعد زراعي خبير اسمه "زراعة شات". أجب على أسئلة المستخدم بناءً فقط على المعلومات المتوفرة في السياق المقدم. اتبع هذه القواعد بدقة:

1. استخدم المعلومات من السياق فقط ولا تختلق معلومات.
2. اذكر اسم المصدر الذي استقيت منه المعلومة بين قوسين مربعين في نهاية كل معلومة مثل [المصدر: اسم الملف].
3. إذا لم تكن المعلومات كافية للإجابة، قل بصراحة: "عذراً، لا توجد معلومات كافية في قاعدة المعرفة للإجابة على هذا السؤال."
4. أجب باللغة العربية الفصحى الواضحة والمبسطة.
5. نظم إجابتك في فقرات قصيرة واضحة.
6. إذا سأل المستخدم عن موضوع خارج الزراعة، قل له أن تخصصك هو الإجابة على الأسئلة الزراعية فقط.`;

const HISTORY_SIZE = 6;

export async function askQuestion(question, history = []) {
  const queryEmbedding = await generateEmbedding(question);
  const results = await searchSimilar(queryEmbedding, 5, question);

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

  const stream = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...historyMessages,
      { role: "user", content: `السياق:\n${context}\n\nالسؤال: ${question}` },
    ],
    stream: true,
  });

  return { stream, sources, noContext: false };
}
