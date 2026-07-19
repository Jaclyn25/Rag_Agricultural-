import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { askQuestion } from "./chat.js";
import {
  readConversations,
  saveConversation,
  deleteConversation,
  getConversation,
} from "../utils/conversations.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// In-memory history for multi-turn context (loaded on demand)
const historyCache = new Map();

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
  const { question, conversationId } = req.body;
  if (!question) return res.status(400).json({ error: "No question provided" });

  const convId = conversationId || crypto.randomUUID();
  const history = await loadHistory(convId);

  history.push({ role: "user", content: question });

  try {
    const { stream, sources, noContext } = await askQuestion(question, history);

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

// Save full conversation from client
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

// List all conversations (summary only)
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

// Get single conversation
app.get("/api/conversations/:id", async (req, res) => {
  try {
    const conv = await getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Not found" });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete conversation
app.delete("/api/conversations/:id", async (req, res) => {
  try {
    await deleteConversation(req.params.id);
    historyCache.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`زراعة شات RAG running at http://localhost:${PORT}`);
});
