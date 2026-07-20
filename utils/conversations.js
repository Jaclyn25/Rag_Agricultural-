import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "conversations.json");

async function ensureDataDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
}

export async function readConversations() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeConversations(data) {
  await ensureDataDir();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

export async function saveConversation(conv) {
  const all = await readConversations();
  const idx = all.findIndex((c) => c.id === conv.id);
  if (idx >= 0) {
    all[idx] = conv;
  } else {
    all.unshift(conv);
  }
  await writeConversations(all);
  return conv;
}

export async function deleteConversation(id) {
  const all = await readConversations();
  const filtered = all.filter((c) => c.id !== id);
  await writeConversations(filtered);
}

export async function getConversation(id) {
  const all = await readConversations();
  return all.find((c) => c.id === id) || null;
}

export async function getConversationsByDateRange(start, end) {
  const all = await readConversations();
  return all.filter(c => c.createdAt >= start && c.createdAt <= end);
}

export async function getConversationsWithFeedback() {
  const all = await readConversations();
  return all.filter(c => c.messages && c.messages.some(m => m.feedback));
}
