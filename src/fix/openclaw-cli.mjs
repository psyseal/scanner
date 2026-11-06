// Cambios de configuración de OpenClaw a través de su propio comando (`openclaw config set`), que valida el
// esquema y respeta los $include. Se ejecuta sin shell y con argumentos fijos; nunca con texto de tus archivos.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const OPENCLAW_CHANGES = {
  'openclaw-isolate': [
    ['agents.defaults.heartbeat.isolatedSession', 'true'],
    ['agents.defaults.heartbeat.lightContext', 'true'],
  ],
  'openclaw-active-hours': [['agents.defaults.heartbeat.activeHours', '{"start":"08:00","end":"22:00"}']],
};

/** Ruta del ejecutable `openclaw` en el PATH (null si no está). En Windows nativo no se usa: OpenClaw corre en WSL2. */
export function findOpenclaw(env = process.env) {
  if (process.platform === 'win32') return null;
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'openclaw');
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mode & 0o111) return p;
    } catch {
      /* no está aquí */
    }
  }
  return null;
}

export function manualCommands(op) {
  return (OPENCLAW_CHANGES[op] || []).map(([k, v]) => `openclaw config set ${k} '${v}' --strict-json`);
}

/** Aplica los cambios de una operación. Lanza si el comando falla (el llamador restaura el respaldo). */
export function runOpenclawChanges(bin, op, { env = process.env } = {}) {
  for (const [key, value] of OPENCLAW_CHANGES[op] || []) {
    execFileSync(bin, ['config', 'set', key, value, '--strict-json'], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, shell: false });
  }
}
