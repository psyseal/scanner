// Plan de limpieza: a partir del reporte del escáner arma la lista de cambios, calcula su vista previa (sin
// mostrar contenido sensible) y aplica solo los aprobados, con respaldo previo de cada archivo.

import fs from 'node:fs';
import path from 'node:path';
import { opsFor } from '../fixable.mjs';
import { safeText } from '../safe.mjs';
import { Backup, writeAtomic } from './backup.mjs';
import { extractBlobs, redactSecrets, removeDuplicateLines, removeInjectionLines, setJsonValue, setTomlValue } from './transforms.mjs';
import { findOpenclaw, manualCommands, runOpenclawChanges } from './openclaw-cli.mjs';

const ORDER = ['quarantine', 'redact', 'dedupe', 'archive', 'chmod600', 'remove-file', 'json-set', 'toml-set', 'openclaw-isolate', 'openclaw-active-hours'];
const FILE_EDIT = new Set(['quarantine', 'redact', 'dedupe', 'archive']);

function readRegularText(abs) {
  const st = fs.lstatSync(abs);
  if (!st.isFile()) throw new Error('not-a-regular-file');
  if (st.size > 2 * 1024 * 1024) throw new Error('too-large');
  return { text: fs.readFileSync(abs, 'utf8'), mode: st.mode & 0o777 };
}

function today(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function archivePathFor(target, platform, now = new Date()) {
  const name = `psyseal-archive-${today(now)}.md`;
  const dir = platform === 'openclaw' && path.basename(target) === 'MEMORY.md' ? path.join(path.dirname(target), 'memory') : path.dirname(target);
  return path.join(dir, name);
}

/** Lista de cambios posibles, sin duplicados, en orden seguro → los que cambian comportamiento. */
export function buildPlan(report) {
  const map = new Map();
  const ocInstall = (report.installs || []).find((i) => i.platform === 'openclaw');
  const add = (agentTag, platform, op, f, agent) => {
    const key = `${op.op}|${op.target || platform}`;
    if (!map.has(key)) {
      const configPath = op.op.startsWith('openclaw-') ? ocInstall?.configPath || null : undefined;
      map.set(key, { key, agentTag, platform, agent, ...op, ...(configPath !== undefined ? { target: configPath } : {}), findings: [] });
    }
    map.get(key).findings.push(f);
  };
  for (const a of report.agents || []) {
    const tag = `${a.platformName} · ${a.id}`;
    const agent = { platform: a.platform, platformName: a.platformName, id: a.id, root: a.root || a.workspace };
    for (const f of a.findings) if (f.severity !== 'info') for (const op of opsFor(f, a.platform)) add(tag, a.platform, op, f, agent);
  }
  // Los cambios de la instalación (por ejemplo, el latido de OpenClaw) cuentan como del primer agente de esa plataforma.
  for (const f of report.globalFindings || []) {
    if (f.severity === 'info') continue;
    const platform = f.data?.platform || 'openclaw';
    const first = (report.agents || []).find((a) => a.platform === platform);
    const agent = first ? { platform, platformName: first.platformName, id: first.id, root: first.root || first.workspace } : null;
    for (const op of opsFor(f, platform)) add(first ? `${first.platformName} · ${first.id}` : platform, platform, op, f, agent);
  }
  return [...map.values()].sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'safe' ? -1 : 1) || ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
}

const shortList = (nums, max = 8) => (nums.length > max ? `${nums.slice(0, max).join(', ')}…` : nums.join(', '));

/** Vista previa de un cambio: solo conteos, tipos, números de línea y valores de configuración (nunca texto de la memoria). */
export function previewAction(action, { now = new Date(), env = process.env, T, home = null }) {
  const tilde = (p) => (home && p && (p === home || p.startsWith(home + path.sep)) ? '~' + p.slice(home.length) : p);
  const file = action.target ? safeText(tilde(action.target), 200) : null;
  try {
    switch (action.op) {
      case 'redact': {
        const { text } = readRegularText(action.target);
        const r = redactSecrets(text);
        const types = [...new Set(r.changes.map((c) => c.type))].join(', ');
        return { ok: r.count > 0, params: { file, count: r.count, types } };
      }
      case 'quarantine': {
        const { text } = readRegularText(action.target);
        const r = removeInjectionLines(text, action.args);
        const reasons = [...new Set(r.removed.map((x) => T.signal(x.signal)))].join(', ');
        return { ok: r.count > 0, params: { file, count: r.count, reasons: `${reasons}; ${T.lines(shortList(r.removed.map((x) => x.line)))}` } };
      }
      case 'dedupe': {
        const { text } = readRegularText(action.target);
        const r = removeDuplicateLines(text);
        return { ok: r.count > 0, params: { file, count: r.count } };
      }
      case 'archive': {
        const { text } = readRegularText(action.target);
        const archive = archivePathFor(action.target, action.platform, now);
        const r = extractBlobs(text, { archiveName: path.basename(archive) });
        return { ok: r.count > 0, params: { file, count: r.count, archive: safeText(tilde(archive), 200) } };
      }
      case 'chmod600': {
        const mode = (fs.lstatSync(action.target).mode & 0o777).toString(8).padStart(3, '0');
        return { ok: mode !== '600', params: { file, mode } };
      }
      case 'remove-file':
        return { ok: fs.lstatSync(action.target).isFile(), params: { file } };
      case 'json-set': {
        const { text } = readRegularText(action.target);
        const r = setJsonValue(text, action.args.keys, action.args.value);
        return { ok: !!r && r.before !== action.args.value, params: { file, keys: action.args.keys.join('.'), before: r?.before, value: action.args.value } };
      }
      case 'toml-set': {
        const { text } = readRegularText(action.target);
        const r = setTomlValue(text, action.args.table, action.args.key, String(action.args.value));
        return { ok: !!r && String(r.before) !== String(action.args.value), params: { file, table: action.args.table, key: action.args.key, before: r?.before, value: action.args.value } };
      }
      case 'openclaw-isolate':
      case 'openclaw-active-hours': {
        const bin = findOpenclaw(env);
        return { ok: true, manual: !bin, bin, commands: manualCommands(action.op), params: {} };
      }
      default:
        return { ok: false, params: {} };
    }
  } catch (e) {
    return { ok: false, error: e.code || e.message, params: { file } };
  }
}

/**
 * Aplica los cambios aprobados. Primero respalda; si algo falla, ese archivo se restaura y se sigue con el resto.
 * @returns {{ backup: Backup, results: Array<{ action, status: 'applied'|'failed', error?: string }>, quarantined: number, redacted: number }}
 */
export function applyPlan(approved, { home, now = new Date(), env = process.env } = {}) {
  const backup = new Backup(home, now);
  const results = [];
  let quarantined = 0;
  let redacted = 0;

  // 1) Ediciones de texto: todas las aprobadas para un archivo se aplican juntas y en orden.
  const byFile = new Map();
  for (const a of approved.filter((x) => FILE_EDIT.has(x.op))) {
    if (!byFile.has(a.target)) byFile.set(a.target, []);
    byFile.get(a.target).push(a);
  }
  for (const [target, actions] of byFile) {
    actions.sort((a, b) => ORDER.indexOf(a.op) - ORDER.indexOf(b.op));
    let entry = null;
    let created = null;
    try {
      const { text: original, mode } = readRegularText(target);
      entry = backup.saveOriginal(target);
      let text = original;
      let archive = null;
      for (const a of actions) {
        if (a.op === 'quarantine') {
          const r = removeInjectionLines(text, a.args);
          text = r.text;
          quarantined += r.count;
          if (r.removed.length) {
            const qfile = path.join(backup.dir, `quarantine-${entry.n}.txt`);
            fs.writeFileSync(qfile, r.removed.map((x) => `# ${path.basename(target)}:${x.line} (${x.signal})\n${x.text}`).join('\n\n') + '\n', { mode: 0o600 });
          }
        } else if (a.op === 'redact') {
          const r = redactSecrets(text);
          text = r.text;
          redacted += r.count;
        } else if (a.op === 'dedupe') {
          text = removeDuplicateLines(text).text;
        } else if (a.op === 'archive') {
          let archivePath = archivePathFor(target, a.platform, now);
          for (let n = 2; fs.existsSync(archivePath); n++) archivePath = archivePathFor(target, a.platform, now).replace(/\.md$/, `-${n}.md`);
          const r = extractBlobs(text, { archiveName: path.basename(archivePath) });
          if (r.count) {
            text = r.text;
            archive = { path: archivePath, body: `# Psyseal archive — ${path.basename(target)} — ${today(now)}\n\n${r.archived}\n` };
          }
        }
      }
      if (archive) {
        fs.mkdirSync(path.dirname(archive.path), { recursive: true });
        fs.writeFileSync(archive.path, archive.body, { mode, flag: 'wx' });
        created = backup.recordCreated(archive.path);
      }
      if (text !== original) writeAtomic(target, text, mode);
      backup.markAfter(entry, target);
      for (const a of actions) results.push({ action: a, status: 'applied' });
    } catch (e) {
      if (entry) restoreOne(backup, entry);
      if (created) {
        try {
          fs.rmSync(created.path);
        } catch {
          /* ya no está */
        }
      }
      for (const a of actions) results.push({ action: a, status: 'failed', error: e.code || e.message });
    }
  }

  // 2) Cambios de archivos y configuración, uno por uno.
  for (const a of approved.filter((x) => !FILE_EDIT.has(x.op))) {
    let entry = null;
    try {
      if (a.op === 'chmod600') {
        if (!fs.lstatSync(a.target).isFile()) throw new Error('not-a-regular-file'); // chmod seguiría un enlace simbólico
        entry = backup.saveOriginal(a.target);
        fs.chmodSync(a.target, 0o600);
        backup.markAfter(entry, a.target);
      } else if (a.op === 'remove-file') {
        if (!fs.lstatSync(a.target).isFile()) throw new Error('not-a-regular-file');
        entry = backup.saveOriginal(a.target);
        fs.rmSync(a.target);
        backup.recordRemoved(entry);
      } else if (a.op === 'json-set') {
        const { text, mode } = readRegularText(a.target);
        const r = setJsonValue(text, a.args.keys, a.args.value);
        if (!r) throw new Error('not-strict-json');
        JSON.parse(r.text);
        entry = backup.saveOriginal(a.target);
        writeAtomic(a.target, r.text, mode);
        backup.markAfter(entry, a.target);
      } else if (a.op === 'toml-set') {
        const { text, mode } = readRegularText(a.target);
        const r = setTomlValue(text, a.args.table, a.args.key, String(a.args.value));
        if (!r) throw new Error('table-not-found');
        entry = backup.saveOriginal(a.target);
        writeAtomic(a.target, r.text, mode);
        backup.markAfter(entry, a.target);
      } else if (a.op === 'openclaw-isolate' || a.op === 'openclaw-active-hours') {
        const bin = findOpenclaw(env);
        if (!bin) throw new Error('openclaw-cli-not-found');
        const existed = a.target && fs.existsSync(a.target);
        if (existed) entry = backup.saveOriginal(a.target);
        runOpenclawChanges(bin, a.op, { env });
        if (entry) backup.markAfter(entry, a.target);
        else if (a.target && fs.existsSync(a.target)) backup.recordCreated(a.target);
      }
      results.push({ action: a, status: 'applied' });
    } catch (e) {
      if (entry) restoreOne(backup, entry);
      results.push({ action: a, status: 'failed', error: e.code || e.message });
    }
  }
  backup.flush({ results: results.map((r) => ({ op: r.action.op, target: r.action.target || null, status: r.status, error: r.error || null })) });
  return { backup, results, quarantined, redacted };
}

/** Restaura un solo archivo desde el respaldo (cuando algo falló a medio camino). */
function restoreOne(backup, entry) {
  try {
    const buf = fs.readFileSync(path.join(backup.dir, entry.copy));
    writeAtomic(entry.path, buf, entry.mode);
    entry.after = entry.before;
    entry.kind = 'restored';
    backup.flush();
  } catch {
    /* el respaldo sigue en disco para restaurarlo a mano */
  }
}
