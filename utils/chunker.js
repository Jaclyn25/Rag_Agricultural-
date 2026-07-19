const CHUNK_SIZE = 400;
const OVERLAP = 80;

export function chunkText(text, source) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];

  if (paragraphs.length <= 1 && paragraphs[0] && paragraphs[0].length > CHUNK_SIZE) {
    const sentences = paragraphs[0].split(/(?<=[.!?])\s+/);
    return chunkBySentences(sentences, source);
  }

  let buffer = "";
  let bufferSource = null;

  for (const para of paragraphs) {
    if (!para) continue;

    if ((buffer + "\n" + para).length > CHUNK_SIZE && buffer.length > 0) {
      chunks.push({ text: buffer.trim(), source: bufferSource || source });
      const words = buffer.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(OVERLAP / 5)).join(" ");
      buffer = overlapWords + "\n" + para;
      bufferSource = source;
    } else {
      buffer = buffer ? buffer + "\n" + para : para;
      bufferSource = source;
    }
  }

  if (buffer.trim()) {
    chunks.push({ text: buffer.trim(), source: bufferSource || source });
  }

  return chunks;
}

function chunkBySentences(sentences, source) {
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    if ((buffer + " " + sentence).length > CHUNK_SIZE && buffer.length > 0) {
      chunks.push({ text: buffer.trim(), source });
      const words = buffer.split(/\s+/);
      buffer = words.slice(-Math.floor(OVERLAP / 5)).join(" ") + " " + sentence;
    } else {
      buffer = buffer ? buffer + " " + sentence : sentence;
    }
  }

  if (buffer.trim()) {
    chunks.push({ text: buffer.trim(), source });
  }

  return chunks;
}
