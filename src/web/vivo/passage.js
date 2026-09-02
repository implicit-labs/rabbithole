/* Map a browser selection back to the exact raw source substring. Rendered
   text collapses and reflows whitespace, so a DOM selection is not always a
   byte-exact slice of the markdown it came from — but the Vivo server only
   accepts passages that are true transcript substrings (that is what keeps
   minted units grounded). Exact match wins; otherwise both sides are
   whitespace-normalized, matched, and the hit is mapped back to raw offsets. */

/** @param {string} source @param {string} selectedText @returns {string | null} */
export function rawPassageForSelection(source, selectedText) {
  const wanted = String(selectedText || "").trim();
  if (!wanted || !source) return null;
  if (source.includes(wanted)) return wanted;

  const normalizedSource = buildNormalizedView(source);
  const normalizedWanted = normalizeText(wanted);
  if (!normalizedWanted) return null;
  const start = normalizedSource.text.indexOf(normalizedWanted);
  if (start < 0) return null;
  const end = start + normalizedWanted.length - 1;
  return source.slice(normalizedSource.starts[start], normalizedSource.ends[end]);
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Normalized text plus per-character raw offset maps. */
function buildNormalizedView(source) {
  let text = "";
  const starts = [];
  const ends = [];
  let pendingWhitespace = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (/\s/.test(character)) {
      pendingWhitespace ??= { start: index, end: index + 1 };
      pendingWhitespace.end = index + 1;
      continue;
    }
    if (pendingWhitespace && text.length > 0) {
      text += " ";
      starts.push(pendingWhitespace.start);
      ends.push(pendingWhitespace.end);
    }
    pendingWhitespace = null;
    text += character;
    starts.push(index);
    ends.push(index + 1);
  }
  return { text, starts, ends };
}
