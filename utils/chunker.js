const CHUNK_SIZE = 500;
const OVERLAP = 100;

const TOPIC_MARKERS = [
  /^#+\s+/m,
  /^[0-9]+[\.\)]\s+/m,
  /^(أولاً|ثانياً|ثالثاً|رابعاً|خامساً|سادساً|سابعاً|ثامناً|تاسعاً|عاشراً|أخيراً)/m,
  /^(مقدمة|تعريف|أنواع|أقسام|خصائص|مميزات|عيوب|أهمية|فوائد|أضرار|طرق|مراحل|خطوات)/m,
];

export function chunkText(text, source) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  let bufferSource = null;
  let currentTopic = null;

  for (const para of paragraphs) {
    const topicMatch = TOPIC_MARKERS.some(m => m.test(para));
    if (topicMatch) {
      currentTopic = para.slice(0, 60);
    }

    if (para.length > CHUNK_SIZE) {
      if (buffer.trim()) {
        chunks.push({ text: buffer.trim(), source: bufferSource || source, category: currentTopic || source, tags: [source.replace(/\.txt$/, ""), currentTopic].filter(Boolean) });
        buffer = "";
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      const subChunks = chunkBySentences(sentences, source);
      for (const sc of subChunks) {
        sc.category = currentTopic || source;
        sc.tags = [source.replace(/\.txt$/, ""), currentTopic].filter(Boolean);
      }
      chunks.push(...subChunks);
      continue;
    }

    if ((buffer + "\n" + para).length > CHUNK_SIZE && buffer.length > 0) {
      chunks.push({ text: buffer.trim(), source: bufferSource || source, category: currentTopic || source, tags: [source.replace(/\.txt$/, ""), currentTopic].filter(Boolean) });
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
    chunks.push({ text: buffer.trim(), source: bufferSource || source, category: currentTopic || source, tags: [source.replace(/\.txt$/, ""), currentTopic].filter(Boolean) });
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
