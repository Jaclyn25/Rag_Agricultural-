import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createHash, timingSafeEqual } from "node:crypto";
import { askQuestion } from "./chat.js";
import { ingestAll } from "./ingest.js";
import { validateCitations } from "../utils/citations.js";
import { applyRetrievalBudget } from "../utils/retrieval-budget.js";
import {
  readConversations, saveConversation, deleteConversation, getConversation,
} from "../utils/conversations.js";
import {
  getStoreStats, getKnowledgeIndex, removeFromKnowledgeIndex,
  deleteBySource, addFeedback, getFeedback, addQAKnowledge, getQAKnowledge, readStore,
  addChunks, deleteQAKnowledge, deleteChunksByTag,
} from "../utils/store.js";
import fs from "fs/promises";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable("x-powered-by");

const TRUST_PROXY = process.env.TRUST_PROXY;
if (TRUST_PROXY) {
  app.set("trust proxy", TRUST_PROXY === "true" ? true : /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
const LOCAL_DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) return cb(null, true);
    if (!ALLOWED_ORIGIN && LOCAL_DEV_ORIGIN.test(origin)) return cb(null, true);
    return cb(null, false);
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const MAX_QUESTION = 4000;
const MAX_ID = 128;
const MAX_TITLE = 200;
const MAX_MESSAGE_COUNT = 500;
const MAX_MESSAGE_CONTENT = 20000;
const MAX_COMMENT = 1000;
const MAX_SOURCE_NAME = 300;
const ALLOWED_MODELS = new Set(["groq", "openai"]);
const ALLOWED_RATINGS = new Set([-1, 0, 1]);
const MAX_STRATEGY_BUDGET = Number(process.env.MAX_STRATEGY_BUDGET) || 3;

function tokensEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function hasValidAdminToken(req) {
  if (!ADMIN_TOKEN) return false;
  return tokensEqual(req.get("X-Admin-Token") || "", ADMIN_TOKEN);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: "ADMIN_TOKEN not configured" });
  if (!hasValidAdminToken(req)) return res.status(401).json({ error: "unauthorized" });
  next();
}

function sendInternalError(res, err, context) {
  console.error(`[${context}] error:`, err);
  if (!res.headersSent) {
    res.status(500).json({ error: "internal server error" });
  }
}

function validateConversation(conv) {
  if (!conv || typeof conv !== "object") return "Invalid conversation";
  if (typeof conv.id !== "string" || !conv.id || conv.id.length > MAX_ID) return "Invalid conversation id";
  if (typeof conv.title !== "string" || conv.title.length > MAX_TITLE) return "Invalid conversation title";
  if (conv.writeToken !== undefined && (typeof conv.writeToken !== "string" || conv.writeToken.length > 128)) return "Invalid writeToken";
  if (!Array.isArray(conv.messages) || conv.messages.length > MAX_MESSAGE_COUNT) return "Invalid conversation messages";
  for (const m of conv.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "Invalid message role";
    if (typeof m.content !== "string" || m.content.length > MAX_MESSAGE_CONTENT) return "Invalid message content";
  }
  if (conv.createdAt !== undefined && !Number.isFinite(conv.createdAt)) return "Invalid createdAt";
  if (conv.updatedAt !== undefined && !Number.isFinite(conv.updatedAt)) return "Invalid updatedAt";
  return null;
}

const historyCache = new Map();
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 30;

function rateLimitMW(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  if (rateLimitMap.size > 5000) {
    for (const [key, arr] of rateLimitMap) {
      if (!arr.some(t => now - t < RATE_LIMIT_WINDOW)) rateLimitMap.delete(key);
    }
  }
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
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

function assignExperiment() {
  const experiments = ["control", "hyde", "expansion", "multiHop", "webFallback"];
  return experiments[Math.floor(Math.random() * experiments.length)];
}

function healthHandler(req, res) {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: Date.now() });
}

app.get("/api/health", healthHandler);
app.get("/health", healthHandler);

app.get("/api/admin/verify", requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.post("/api/chat", rateLimitMW, async (req, res) => {
  const {
    question, conversationId, model = "groq", useHyde = false,
    useExpansion = false, useSelfRag = false, useMultiHop = false, useWebFallback = false
  } = req.body || {};

  if (typeof question !== "string" || !question.trim()) {
    return res.status(400).json({ error: "No question provided" });
  }
  if (question.length > MAX_QUESTION) {
    return res.status(400).json({ error: `Question too long (max ${MAX_QUESTION} characters)` });
  }
  if (conversationId !== undefined && (typeof conversationId !== "string" || !conversationId || conversationId.length > MAX_ID)) {
    return res.status(400).json({ error: "Invalid conversationId" });
  }
  if (!ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: "Invalid model" });
  }

  const needsGroq = model === "groq" || useHyde || useExpansion || useSelfRag || useMultiHop || useWebFallback;
  if (needsGroq && !process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: "GROQ_API_KEY not configured" });
  }

  const convId = conversationId || crypto.randomUUID();
  const history = [...(await loadHistory(convId))];
  history.push({ role: "user", content: question });

  const experimentId = assignExperiment();
  const requested = {
    useHyde: Boolean(useHyde),
    useExpansion: Boolean(useExpansion),
    useMultiHop: Boolean(useMultiHop),
    useWebFallback: Boolean(useWebFallback),
  };
  const budget = applyRetrievalBudget(requested, MAX_STRATEGY_BUDGET);
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on("close", onClose);

  try {
    const { stream, sources, noContext } = await askQuestion(question, history, {
      model,
      useHyde: budget.useHyde,
      useExpansion: budget.useExpansion,
      useSelfRag: Boolean(useSelfRag),
      useMultiHop: budget.useMultiHop,
      useWebFallback: budget.useWebFallback,
      experimentId,
      signal: controller.signal,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ strategiesRun: budget.strategiesRun, budgetUsed: budget.budgetUsed, experimentId })}\n\n`);

    if (noContext) {
      const reply = "عذراً، لا توجد معلومات كافية في قاعدة المعرفة للإجابة على هذا السؤال.";
      history.push({ role: "assistant", content: reply });
      historyCache.set(convId, history);
      res.write(`data: ${JSON.stringify({ content: reply, conversationId: convId, experimentId })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    let fullReply = "";
    for await (const chunk of stream) {
      if (controller.signal.aborted) break;
      const content = chunk?.choices?.[0]?.delta?.content || "";
      if (content) {
        fullReply += content;
        res.write(`data: ${JSON.stringify({ content, conversationId: convId })}\n\n`);
      }
    }

    if (fullReply) history.push({ role: "assistant", content: fullReply });
    if (sources && sources.length > 0) {
      const citationCheck = validateCitations(fullReply, sources);
      if (citationCheck.invalid.length > 0) {
        console.warn(`[api/chat] invalid citation markers ignored: ${JSON.stringify(citationCheck.invalid)}`);
      }
      res.write(`data: ${JSON.stringify({ sources, conversationId: convId })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();

    if (history.length > 0) historyCache.set(convId, history.slice(-100));
  } catch (err) {
    if (controller.signal.aborted || err?.name === "AbortError") {
      if (!res.headersSent) res.status(499).json({ error: "client aborted" });
      return;
    }
    console.error("[api/chat] error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal server error" });
    } else {
      try { res.end(); } catch { /* client already gone */ }
    }
  } finally {
    res.off("close", onClose);
  }
});

app.post("/api/conversations", async (req, res) => {
  try {
    const conv = req.body;
    const validationError = validateConversation(conv);
    if (validationError) return res.status(400).json({ error: validationError });

    const existing = await getConversation(conv.id);
    if (existing) {
      if (existing.writeToken) {
        const providedToken = typeof conv.writeToken === "string" ? conv.writeToken : "";
        if (!tokensEqual(providedToken, existing.writeToken)) {
          return res.status(403).json({ error: "write token required to update an existing conversation" });
        }
      } else {
        conv.writeToken = crypto.randomUUID();
      }
    } else {
      conv.writeToken = crypto.randomUUID();
    }

    const saved = await saveConversation(conv);
    historyCache.set(conv.id, conv.messages.map(m => ({ role: m.role, content: m.content })));
    res.json({ ok: true, id: saved.id, writeToken: saved.writeToken });
  } catch (err) {
    sendInternalError(res, err, "conversations.save");
  }
});

app.get("/api/conversations", requireAdmin, async (req, res) => {
  try {
    const all = await readConversations();
    res.json(all.map(c => ({
      id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
      preview: c.messages?.filter(m => m.role === "assistant").pop()?.content?.slice(0, 50) || "",
      messageCount: c.messages?.length || 0,
    })));
  } catch (err) {
    sendInternalError(res, err, "conversations.list");
  }
});

app.get("/api/conversations/:id", requireAdmin, async (req, res) => {
  try {
    if (!req.params.id || req.params.id.length > MAX_ID) return res.status(400).json({ error: "Invalid id" });
    const conv = await getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Not found" });
    res.json(conv);
  } catch (err) {
    sendInternalError(res, err, "conversations.get");
  }
});

app.delete("/api/conversations/:id", async (req, res) => {
  try {
    if (!req.params.id || req.params.id.length > MAX_ID) return res.status(400).json({ error: "Invalid id" });
    const conv = await getConversation(req.params.id);
    if (!conv) return res.json({ ok: true });
    const writeToken = req.get("X-Write-Token") || "";
    if (!hasValidAdminToken(req) && (!conv.writeToken || !tokensEqual(writeToken, conv.writeToken))) {
      return res.status(403).json({ error: "write token required to delete this conversation" });
    }
    await deleteConversation(req.params.id);
    historyCache.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendInternalError(res, err, "conversations.delete");
  }
});

app.get("/api/knowledge/stats", async (req, res) => {
  try {
    const stats = await getStoreStats();
    const index = await getKnowledgeIndex();
    res.json({ stats, index });
  } catch (err) {
    sendInternalError(res, err, "knowledge.stats");
  }
});

app.get("/api/knowledge/sources", async (req, res) => {
  try {
    res.json(await getKnowledgeIndex());
  } catch (err) {
    sendInternalError(res, err, "knowledge.sources");
  }
});

app.get("/api/knowledge/source/:name", async (req, res) => {
  try {
    const name = req.params.name || "";
    if (name.length > MAX_SOURCE_NAME) return res.status(400).json({ error: "Invalid source" });
    const store = await readStore();
    const chunks = store.filter(e => e.source === name).map(e => ({ text: e.text }));
    res.json({ source: name, chunks });
  } catch (err) {
    sendInternalError(res, err, "knowledge.source");
  }
});

app.post("/api/knowledge/ingest", requireAdmin, async (req, res) => {
  try {
    const total = await ingestAll();
    res.json({ ok: true, totalChunks: total });
  } catch (err) {
    sendInternalError(res, err, "knowledge.ingest");
  }
});

app.post("/api/knowledge/delete", requireAdmin, async (req, res) => {
  try {
    const { source } = req.body || {};
    if (typeof source !== "string" || !source || source.length > MAX_SOURCE_NAME) {
      return res.status(400).json({ error: "Source required" });
    }
    await deleteBySource(source);
    await removeFromKnowledgeIndex(source);
    res.json({ ok: true });
  } catch (err) {
    sendInternalError(res, err, "knowledge.delete");
  }
});

app.post("/api/feedback", rateLimitMW, async (req, res) => {
  try {
    const { conversationId, messageIndex, rating, comment, experimentId } = req.body || {};
    if (typeof conversationId !== "string" || !conversationId || conversationId.length > MAX_ID) {
      return res.status(400).json({ error: "conversationId required" });
    }
    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
      return res.status(400).json({ error: "Invalid messageIndex" });
    }
    if (!ALLOWED_RATINGS.has(rating)) {
      return res.status(400).json({ error: "Invalid rating" });
    }
    if (comment !== undefined && (typeof comment !== "string" || comment.length > MAX_COMMENT)) {
      return res.status(400).json({ error: "Invalid comment" });
    }
    if (experimentId !== undefined && (typeof experimentId !== "string" || experimentId.length > 64)) {
      return res.status(400).json({ error: "Invalid experimentId" });
    }
    await addFeedback({ conversationId, messageIndex, rating, comment, experimentId, timestamp: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    sendInternalError(res, err, "feedback.add");
  }
});

app.post("/api/knowledge/qa", requireAdmin, async (req, res) => {
  try {
    const { question, answer, source } = req.body || {};
    if (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION) {
      return res.status(400).json({ error: "Question required" });
    }
    if (typeof answer !== "string" || !answer.trim() || answer.length > MAX_MESSAGE_CONTENT) {
      return res.status(400).json({ error: "Answer required" });
    }
    if (source !== undefined && (typeof source !== "string" || source.length > MAX_SOURCE_NAME)) {
      return res.status(400).json({ error: "Invalid source" });
    }
    const qa = await addQAKnowledge({ question, answer, source: "user_qa" });
    if (qa.created) {
      const { generateEmbedding } = await import("../utils/embed.js");
      const text = `سؤال: ${question}\nجواب: ${answer}`;
      const embedding = await generateEmbedding(text);
      await addChunks([{ text, source: "user_qa" }], [embedding], {
        category: "user_qa",
        tags: [`qa:${qa.entry.id}`, "user_qa"],
      });
    }
    res.json({ ok: true, id: qa.entry.id, created: qa.created, provenance: qa.entry.provenance });
  } catch (err) {
    sendInternalError(res, err, "knowledge.qa.add");
  }
});

app.get("/api/knowledge/qa", requireAdmin, async (req, res) => {
  try { res.json(await getQAKnowledge()); } catch (err) { sendInternalError(res, err, "knowledge.qa.list"); }
});

app.delete("/api/knowledge/qa/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id || "";
    if (!id || id.length > 128) return res.status(400).json({ error: "Invalid id" });
    await deleteQAKnowledge(id);
    await deleteChunksByTag(`qa:${id}`);
    res.json({ ok: true });
  } catch (err) {
    sendInternalError(res, err, "knowledge.qa.delete");
  }
});

app.get("/api/feedback", requireAdmin, async (req, res) => {
  try { res.json(await getFeedback()); } catch (err) { sendInternalError(res, err, "feedback.list"); }
});

app.get("/api/eval/results", async (req, res) => {
  try {
    const raw = await fs.readFile(path.join(__dirname, "..", "data", "eval_results.json"), "utf-8");
    res.json(JSON.parse(raw));
  } catch { res.json({ best: null, all: [], timestamp: null }); }
});

app.post("/api/eval/run", requireAdmin, async (req, res) => {
  try {
    const { exec } = await import("child_process");
    exec("node server/eval.js", (err, stdout) => {
      if (err) return res.status(500).json({ error: "eval failed" });
      res.json({ ok: true, output: stdout });
    });
  } catch (err) {
    sendInternalError(res, err, "eval.run");
  }
});

app.post("/api/knowledge/reembed", requireAdmin, async (req, res) => {
  try {
    const store = await readStore();
    const { generateEmbedding } = await import("../utils/embed.js");
    let updated = 0;
    for (const entry of store) {
      const newEmbedding = await generateEmbedding(entry.text);
      entry.embedding = newEmbedding;
      entry.version = (entry.version || 1) + 1;
      entry.ingestedAt = Date.now();
      updated++;
    }
    const { writeStore } = await import("../utils/store.js");
    await writeStore(store);
    res.json({ ok: true, updatedChunks: updated });
  } catch (err) {
    sendInternalError(res, err, "knowledge.reembed");
  }
});

export { app };
