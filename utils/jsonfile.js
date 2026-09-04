import fs from "fs/promises";
import path from "path";

const chains = new Map();

function enqueue(key, task) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(() => task(), () => task());
  chains.set(key, next.catch(() => {}));
  return next;
}

export async function withFileLock(key, task) {
  return enqueue(key, task);
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

export async function atomicWriteFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function updateJsonFile(filePath, fallback, updater) {
  return withFileLock(filePath, async () => {
    const current = await readJson(filePath, fallback);
    const result = await updater(current);
    await atomicWriteFile(filePath, result);
    return result;
  });
}
