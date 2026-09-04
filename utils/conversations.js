import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { updateJsonFile, atomicWriteFile } from "./jsonfile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.ZERAEH_DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "conversations.json");

export async function readConversations() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeConversations(data) {
  await atomicWriteFile(DATA_FILE, data);
}

export async function saveConversation(conv) {
  await updateJsonFile(DATA_FILE, [], (all) => {
    const idx = all.findIndex((c) => c.id === conv.id);
    if (idx >= 0) {
      all[idx] = conv;
    } else {
      all.unshift(conv);
    }
    return all;
  });
  return conv;
}

export async function deleteConversation(id) {
  await updateJsonFile(DATA_FILE, [], (all) => all.filter((c) => c.id !== id));
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
