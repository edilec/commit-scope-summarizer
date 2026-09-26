export class EvidenceError extends Error {}

export function parseStrictJson(text, { maxDepth = 64, maxNodes = 100000 } = {}) {
  if (typeof text !== 'string') throw new EvidenceError('JSON text is unavailable.');
  if (![maxDepth, maxNodes].every(x => Number.isSafeInteger(x) && x > 0)) {
    throw new TypeError('Invalid parser bounds.');
  }
  let i = 0;
  let nodes = 0;
  const invalid = message => { throw new EvidenceError(message); };
  const space = () => { while (i < text.length && /[\u0020\t\r\n]/u.test(text[i])) i++; };
  const string = () => {
    if (text[i] !== '"') invalid('Expected JSON string.');
    const start = i++;
    while (i < text.length) {
      const ch = text[i++];
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, i)); }
        catch { invalid('Invalid JSON string.'); }
      }
      if (ch.charCodeAt(0) < 32) invalid('Invalid JSON string.');
      if (ch === '\\') i++;
    }
    invalid('Unterminated JSON string.');
  };
  const value = depth => {
    if (++nodes > maxNodes) invalid('JSON nodes limit exceeded.');
    space();
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      if (depth + 1 > maxDepth) invalid('JSON depth limit exceeded.');
      const object = ch === '{';
      i++;
      space();
      if (text[i] === (object ? '}' : ']')) { i++; return; }
      const keys = object ? new Set() : null;
      while (i < text.length) {
        if (object) {
          const key = string();
          if (keys.has(key)) invalid('Duplicate JSON key.');
          keys.add(key);
          space();
          if (text[i++] !== ':') invalid('Expected JSON colon.');
        }
        value(depth + 1);
        space();
        if (text[i] === (object ? '}' : ']')) { i++; return; }
        if (text[i++] !== ',') invalid('Expected JSON comma.');
        space();
      }
      invalid('Unterminated JSON container.');
    }
    if (ch === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, i)) { i += literal.length; return; }
    }
    if (ch === '-' || /[0-9]/u.test(ch ?? '')) invalid('Unsupported JSON number.');
    invalid('Invalid JSON token.');
  };
  value(0);
  space();
  if (i !== text.length) invalid('Trailing JSON data.');
  try { return JSON.parse(text); }
  catch { invalid('Invalid JSON document.'); }
}
