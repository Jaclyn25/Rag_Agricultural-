import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { askQuestion } from "./chat.js";
import { ingestAll } from "./ingest.js";
import {
  readConversations,
  saveConversation,
  deleteConversation,
  getConversation,
} from "../utils/conversations.js";
import {
  getStoreStats,
  getKnowledgeIndex,
  addToKnowledgeIndex,
  removeFromKnowledgeIndex,
  deleteBySource,
  addFeedback,
  getFeedback,
  addQAKnowledge,
  getQAKnowledge,
} from "../utils/store.js";
import { chunkText } from "../utils/chunker.js";
import { generateEmbeddings } from "../utils/embed.js";
import { addChunks } from "../utils/store.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const historyCache = new Map();
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 30;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < RATE_LIMIT_WINDOW);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: "طلبات كثيرة جداً. الرجاء الانتظار قليلاً." });
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  next();
}

async function loadHistory(convId) {
  if (historyCache.has(convId)) return historyCache.get(convId);
  const conv = await getConversation(convId);
  const msgs = conv ? conv.messages || [] : [];
  const history = msgs.map((m) => ({ role: m.role, content: m.content }));
  historyCache.set(convId, history);
  return history;
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: Date.now() });
});

app.post("/api/chat", async (req, res) => {
  const { question, conversationId, model = "groq", useHyde = false, useExpansion = false, useSelfRag = false } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });

  const convId = conversationId || crypto.randomUUID();
  const history = await loadHistory(convId);

  history.push({ role: "user", content: question });

  try {
    const { stream, sources, noContext } = await askQuestion(question, history, { model, useHyde, useExpansion, useSelfRag });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (noContext) {
      const reply = "عذراً، لا توجد معلومات كافية في قاعدة المعرفة للإجابة على هذا السؤال.";
      history.push({ role: "assistant", content: reply });
      res.write(`data: ${JSON.stringify({ content: reply, conversationId: convId })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    let fullReply = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullReply += content;
        res.write(`data: ${JSON.stringify({ content, conversationId: convId })}\n\n`);
      }
    }

    if (fullReply) {
      history.push({ role: "assistant", content: fullReply });
    }

    if (sources && sources.length > 0) {
      res.write(`data: ${JSON.stringify({ sources, conversationId: convId })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();

    if (history.length > 50) {
      historyCache.set(convId, history.slice(-30));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/conversations", async (req, res) => {
  try {
    const conv = req.body;
    if (!conv || !conv.id) return res.status(400).json({ error: "Invalid conversation" });
    const saved = await saveConversation(conv);
    historyCache.set(conv.id, conv.messages.map((m) => ({ role: m.role, content: m.content })));
    res.json({ ok: true, id: saved.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/conversations", async (req, res) => {
  try {
    const all = await readConversations();
    const summaries = all.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      preview: c.messages?.filter((m) => m.role === "assistant").pop()?.content?.slice(0, 50) || "",
      messageCount: c.messages?.length || 0,
    }));
    res.json(summaries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/conversations/:id", async (req, res) => {
  try {
    const conv = await getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Not found" });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  try {
    await deleteConversation(req.params.id);
    historyCache.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/knowledge/stats", async (req, res) => {
  try {
    const stats = await getStoreStats();
    const index = await getKnowledgeIndex();
    res.json({ stats, index });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/knowledge/sources", async (req, res) => {
  try {
    const index = await getKnowledgeIndex();
    res.json(index);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/knowledge/ingest", async (req, res) => {
  try {
    const total = await ingestAll();
    res.json({ ok: true, totalChunks: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/knowledge/delete", async (req, res) => {
  try {
    const { source } = req.body;
    if (!source) return res.status(400).json({ error: "Source required" });
    await deleteBySource(source);
    await removeFromKnowledgeIndex(source);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/feedback", async (req, res) => {
  try {
    const { conversationId, messageIndex, rating, comment } = req.body;
    if (!conversationId || rating === undefined) {
      return res.status(400).json({ error: "conversationId and rating required" });
    }
    await addFeedback({ conversationId, messageIndex, rating, comment });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/knowledge/qa", async (req, res) => {
  try {
    const { question, answer, source } = req.body;
    if (!question || !answer) return res.status(400).json({ error: "Question and answer required" });
    await addQAKnowledge({ question, answer, source: source || "user_qa" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/knowledge/qa", async (req, res) => {
  try {
    const qa = await getQAKnowledge();
    res.json(qa);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/feedback", async (req, res) => {
  try {
    const feedback = await getFeedback();
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`زراعة شات RAG running at http://localhost:${PORT}`);
});
