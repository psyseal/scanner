// Transformaciones puras de texto que usa la limpieza. Cada una recibe el texto actual y devuelve el nuevo,
// más un resumen sin contenido sensible. Se recalculan al aplicar (no se guardan posiciones viejas).

import { scanSecrets } from '../detectors/secrets.mjs';
import { scanInjection } from '../detectors/injection.mjs';

const EOL = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

export const REDACTION = (label) => `[REDACTED by Psyseal: ${label}. Rotate this key at the provider]`;

/** Tapa cada credencial detectada. Los bloques PEM se tapan completos (del BEGIN al END). */
export function redactSecrets(text) {
  const nl = EOL(text);
  const lines = text.split(/\r?\n/);
  const found = scanSecrets(text, { withSpans: true, limit: 500 });
  const byLine = new Map();
  for (const s of found) {
    if (!byLine.has(s.line)) byLine.set(s.line, []);
    byLine.get(s.line).push(s);
  }
  const changes = [];
  const pemRanges = [];
  for (const [ln, hits] of byLine) {
    const idx = ln - 1;
    let line = lines[idx];
    // De derecha a izquierda para no mover las posiciones pendientes.
    for (const h of [...hits].sort((a, b) => b.start - a.start)) {
      if (h.id === 'private-key-block') {
        let end = idx;
        for (let j = idx; j < Math.min(lines.length, idx + 200); j++) {
          if (/-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/.test(lines[j])) {
            end = j;
            break;
          }
        }
        pemRanges.push([idx, end, h.label]);
        continue;
      }
      line = line.slice(0, h.start) + REDACTION(h.label) + line.slice(h.end);
      changes.push({ line: ln, type: h.label });
    }
    lines[idx] = line;
  }
  for (const [a, b, label] of pemRanges.sort((x, y) => y[0] - x[0])) {
    lines.splice(a, b - a + 1, REDACTION(label));
    changes.push({ line: a + 1, type: label });
  }
  return { text: lines.join(nl), count: changes.length, changes: changes.sort((a, b) => a.line - b.line) };
}

/** Quita las líneas marcadas como instrucciones colocadas desde fuera. Devuelve las líneas quitadas aparte (para el respaldo). */
export function removeInjectionLines(text, { strict = true } = {}) {
  const nl = EOL(text);
  const lines = text.split(/\r?\n/);
  const hits = scanInjection(text, { strict, limit: 500 });
  const drop = new Map();
  for (const h of hits) if (!drop.has(h.line)) drop.set(h.line, h.id);
  const removed = [];
  const kept = [];
  lines.forEach((l, i) => {
    if (drop.has(i + 1)) removed.push({ line: i + 1, signal: drop.get(i + 1), text: l });
    else kept.push(l);
  });
  return { text: kept.join(nl), count: removed.length, removed };
}

const MIN_DUP_LEN = 25;
const BLOB_LINE_LEN = 1500;
const BIG_FENCE_LINES = 60;
const isStructural = (line) => /^(?:#{1,6}\s|[-*_=]{3,}\s*$|```|~~~|\|[-: |]+\|\s*$|§\s*$)/.test(line.trim());
const norm = (line) => line.trim().replace(/\s+/g, ' ').toLowerCase();

/** Quita líneas repetidas (se queda con la primera). No toca títulos, separadores ni líneas cortas, ni el interior de bloques de código. */
export function removeDuplicateLines(text) {
  const nl = EOL(text);
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const out = [];
  let inFence = false;
  let removed = 0;
  for (const l of lines) {
    if (/^(?:```|~~~)/.test(l.trim())) {
      inFence = !inFence;
      out.push(l);
      continue;
    }
    if (inFence || l.trim().length < MIN_DUP_LEN || l.length > BLOB_LINE_LEN || isStructural(l)) {
      out.push(l);
      continue;
    }
    const k = norm(l);
    if (seen.has(k)) {
      removed++;
      continue;
    }
    seen.add(k);
    out.push(l);
  }
  return { text: out.join(nl), count: removed };
}

/** Saca líneas gigantes y bloques de código largos a un archivo aparte; deja una nota en su lugar. */
export function extractBlobs(text, { archiveName }) {
  const nl = EOL(text);
  const lines = text.split(/\r?\n/);
  const out = [];
  const archived = [];
  let i = 0;
  let count = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^(?:```|~~~)/.test(l.trim())) {
      let j = i + 1;
      while (j < lines.length && !/^(?:```|~~~)/.test(lines[j].trim())) j++;
      const body = j - i - 1;
      if (j < lines.length && body > BIG_FENCE_LINES) {
        archived.push(lines.slice(i, j + 1).join(nl));
        out.push(`> [Psyseal: a ${body}-line code block moved to ${archiveName}]`);
        count++;
        i = j + 1;
        continue;
      }
      out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
      i = j + 1;
      continue;
    }
    if (l.length > BLOB_LINE_LEN) {
      archived.push(l);
      out.push(`> [Psyseal: a ${l.length}-character line moved to ${archiveName}]`);
      count++;
      i++;
      continue;
    }
    out.push(l);
    i++;
  }
  return { text: out.join(nl), count, archived: archived.join(nl + nl) };
}

/** Cambia un valor en un JSON estricto. Devuelve null si el archivo no es JSON estricto (con comentarios no se toca). */
export function setJsonValue(text, keys, value) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  let cur = data;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] === undefined) cur[k] = {};
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) return null;
    cur = cur[k];
  }
  const before = cur[keys[keys.length - 1]];
  cur[keys[keys.length - 1]] = value;
  const indent = /^\{\r?\n(\t| +)/.exec(text)?.[1] ?? '  ';
  const out = JSON.stringify(data, null, indent) + (text.endsWith('\n') ? EOL(text) : '');
  return { text: EOL(text) === '\r\n' ? out.replace(/\r?\n/g, '\r\n') : out, before };
}

/** Cambia `key = valor` dentro de [table] en un TOML; si la clave no existe, la agrega al final de la tabla. */
export function setTomlValue(text, table, key, value) {
  const nl = EOL(text);
  const lines = text.split(/\r?\n/);
  let inTable = false;
  let tableStart = -1;
  let tableEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = /^\s*\[\s*([^\][]+?)\s*\]\s*(?:#.*)?$/.exec(lines[i]);
    if (t) {
      if (inTable) {
        tableEnd = i;
        break;
      }
      inTable = t[1].replace(/\s*\.\s*/g, '.') === table;
      if (inTable) tableStart = i;
      continue;
    }
    if (inTable) {
      const m = new RegExp(`^(\\s*${key}\\s*=\\s*)([^#\\n]*?)(\\s*(?:#.*)?)$`).exec(lines[i]);
      if (m) {
        const before = m[2].trim();
        lines[i] = `${m[1]}${value}${m[3]}`;
        return { text: lines.join(nl), before };
      }
    }
  }
  if (tableStart === -1) return null;
  let insertAt = tableEnd;
  while (insertAt > tableStart + 1 && !lines[insertAt - 1].trim()) insertAt--;
  lines.splice(insertAt, 0, `${key} = ${value}`);
  return { text: lines.join(nl), before: null };
}
