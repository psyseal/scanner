// Respaldo y deshacer. Antes de tocar un archivo se copia a ~/.psyseal/backups/<id>/ con un manifiesto
// (ruta, permisos y huellas SHA-256 antes y después). "Deshacer" solo restaura si el archivo sigue como lo dejó
// la limpieza, para no pisar cambios que hayas hecho después.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function psysealDir(home) {
  return path.join(home, '.psyseal');
}

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** Escritura atómica: archivo temporal en la misma carpeta y renombrar. Conserva los permisos. */
export function writeAtomic(abs, data, mode) {
  const tmp = `${abs}.psyseal-tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, data, { mode: mode ?? 0o600, flag: 'wx' });
  if (mode !== undefined) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, abs);
}

export class Backup {
  constructor(home, now = new Date()) {
    let id = stamp(now);
    const base = path.join(psysealDir(home), 'backups');
    let dir = path.join(base, id);
    for (let n = 2; fs.existsSync(dir); n++) dir = path.join(base, `${id}-${n}`);
    this.id = path.basename(dir);
    this.dir = dir;
    this.entries = [];
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(psysealDir(home), 0o700);
      fs.chmodSync(base, 0o700);
    } catch {
      /* Windows u otros: mejor esfuerzo */
    }
  }

  /** Guarda la versión actual de un archivo existente antes de cambiarlo. */
  saveOriginal(abs) {
    const st = fs.statSync(abs);
    const buf = fs.readFileSync(abs);
    const n = this.entries.length + 1;
    const copy = path.join(this.dir, 'files', `${n}-${path.basename(abs)}`);
    fs.writeFileSync(copy, buf, { mode: 0o600 });
    const entry = { n, path: abs, kind: 'modified', mode: st.mode & 0o777, before: sha256(buf), after: null, copy: path.relative(this.dir, copy) };
    this.entries.push(entry);
    this.flush();
    return entry;
  }

  /** Registra un archivo creado por la limpieza (deshacer lo borra). */
  recordCreated(abs) {
    const entry = { n: this.entries.length + 1, path: abs, kind: 'created', mode: null, before: null, after: sha256(fs.readFileSync(abs)), copy: null };
    this.entries.push(entry);
    this.flush();
    return entry;
  }

  /** Registra un archivo quitado (queda la copia en el respaldo). */
  recordRemoved(entry) {
    entry.kind = 'removed';
    entry.after = null;
    this.flush();
  }

  markAfter(entry, absNow) {
    entry.after = fs.existsSync(absNow) ? sha256(fs.readFileSync(absNow)) : null;
    if (fs.existsSync(absNow)) entry.modeAfter = fs.statSync(absNow).mode & 0o777;
    this.flush();
  }

  flush(extra = {}) {
    const manifest = { tool: 'psyseal-fix', id: this.id, createdAt: new Date().toISOString(), entries: this.entries, ...this.meta, ...extra };
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  }
}

export function listBackups(home) {
  const base = path.join(psysealDir(home), 'backups');
  let names = [];
  try {
    names = fs.readdirSync(base).filter((n) => fs.existsSync(path.join(base, n, 'manifest.json')));
  } catch {
    return [];
  }
  return names.sort().reverse().map((id) => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(base, id, 'manifest.json'), 'utf8'));
      return { id, createdAt: m.createdAt, files: m.entries.length };
    } catch {
      return { id, createdAt: null, files: 0 };
    }
  });
}

/**
 * Restaura un respaldo. Devuelve { restored: [...], skipped: [{ path, reason }] }.
 * Sin `force`, no pisa archivos que cambiaron después de la limpieza.
 */
export function undoBackup(home, id, { force = false } = {}) {
  if (!/^[0-9]{8}-[0-9]{6}(?:-[0-9]+)?$/.test(id)) throw new Error('bad-id');
  const dir = path.join(psysealDir(home), 'backups', id);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const restored = [];
  const skipped = [];
  for (const e of [...manifest.entries].reverse()) {
    const exists = fs.existsSync(e.path);
    const current = exists ? sha256(fs.readFileSync(e.path)) : null;
    if (e.kind === 'created') {
      if (!exists) continue;
      if (current !== e.after && !force) {
        skipped.push({ path: e.path, reason: 'changed' });
        continue;
      }
      fs.rmSync(e.path);
      restored.push(e.path);
      continue;
    }
    if (!force && current !== e.after) {
      skipped.push({ path: e.path, reason: exists ? 'changed' : 'missing' });
      continue;
    }
    const buf = fs.readFileSync(path.join(dir, e.copy));
    fs.mkdirSync(path.dirname(e.path), { recursive: true });
    if (exists) writeAtomic(e.path, buf, e.mode ?? undefined);
    else fs.writeFileSync(e.path, buf, { mode: e.mode ?? 0o600 });
    if (e.mode !== null && e.mode !== undefined) {
      try {
        fs.chmodSync(e.path, e.mode);
      } catch {
        /* mejor esfuerzo */
      }
    }
    restored.push(e.path);
  }
  return { restored, skipped };
}
