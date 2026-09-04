export function extractSourceMarkers(text) {
  const markers = [];
  const re = /\[SOURCE_(\d+)\]/g;
  let m;
  while ((m = re.exec(String(text))) !== null) {
    markers.push({ index: Number(m[1]), position: m.index });
  }
  return markers;
}

export function validateCitations(text, sourceNames) {
  const markers = extractSourceMarkers(text);
  const valid = [];
  const invalid = [];
  for (const mk of markers) {
    const name = sourceNames[mk.index - 1];
    if (name !== undefined) {
      if (!valid.includes(mk.index)) valid.push(mk.index);
    } else {
      if (!invalid.includes(mk.index)) invalid.push(mk.index);
    }
  }
  return { valid, invalid };
}
