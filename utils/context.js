export function buildContext(results, maxChars = Infinity, seenTexts = null) {
  const parts = [];
  const usedSources = [];
  const seenSources = new Set();
  const seenText = seenTexts || new Set();
  let totalChars = 0;

  for (const r of results) {
    const textKey = String(r.text).trim();
    if (seenText.has(textKey)) continue;
    const label = `[SOURCE_${parts.length + 1}: ${r.source}]`;
    const block = `${label}\n${textKey}`;
    if (totalChars + block.length > maxChars && parts.length > 0) break;
    parts.push(block);
    totalChars += block.length;
    seenText.add(textKey);
    if (!seenSources.has(r.source)) {
      seenSources.add(r.source);
      usedSources.push(r.source);
    }
  }

  return {
    text: `<retrieved_context>\n${parts.join("\n\n---\n\n")}\n</retrieved_context>`,
    usedSources,
    charCount: totalChars,
    blockCount: parts.length,
  };
}
