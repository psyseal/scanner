// Licencia de la limpieza y del sello. Habla solo con la API de licencias de Polar, la plataforma que cobra:
// envía tu clave, el ID de la tienda y, por cada agente, un código seudónimo (no su nombre de carpeta ni sus
// archivos) y una etiqueta con la plataforma y el nombre corto del agente, para que veas en tu portal qué
// agentes usan tu plan. Nunca envía contenido de tus agentes.
//
// Cada plan cubre un número de agentes (las "activaciones" de la licencia). El primer uso en un agente lo activa;
// los siguientes solo lo validan. Si el plan ya no está pagado, Polar revoca la licencia y todo deja de funcionar.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LICENSE } from '../brand.mjs';
import { psysealDir } from './backup.mjs';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function licenseConfig(env = process.env) {
  return {
    api: env.PSYSEAL_LICENSE_API || LICENSE.api,
    // PSYSEAL_LICENSE_ORG vacío apaga la tienda (lo usan las pruebas); sin definir, se usa la de la marca.
    organizationId: Object.hasOwn(env, 'PSYSEAL_LICENSE_ORG') ? env.PSYSEAL_LICENSE_ORG : LICENSE.organizationId,
    checkoutUrl: LICENSE.checkoutUrl,
    portalUrl: LICENSE.portalUrl,
  };
}

function storePath(home) {
  return path.join(psysealDir(home), 'license.json');
}

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, text, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
}

/** Sal aleatoria de este equipo: hace que el código seudónimo de un agente no se pueda adivinar desde fuera. */
export function machineSalt(home) {
  const file = path.join(psysealDir(home), 'machine-id');
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(v)) return v;
  } catch {
    /* se crea abajo */
  }
  const v = crypto.randomBytes(16).toString('hex');
  writePrivate(file, v + '\n');
  return v;
}

/** Código seudónimo y estable de un agente en este equipo (queda ligado a tu licencia al activarlo). */
export function agentHash(home, agent) {
  let root = agent.root || agent.workspace || '';
  try {
    root = fs.realpathSync.native(root);
  } catch {
    /* la carpeta puede no existir */
  }
  if (process.platform === 'win32' || process.platform === 'darwin') root = root.toLowerCase();
  return crypto.createHash('sha256').update(`psyseal-agent-v1|${machineSalt(home)}|${agent.platform}|${root}|${agent.id}`).digest('hex');
}

/** Lo que verás en tu portal de Polar junto a cada activación. */
export function agentLabel(agent) {
  return `${agent.platformName || agent.platform} · ${agent.id}`.replace(/[\u0000-\u001f]/g, '').slice(0, 80);
}

export function loadStored(home) {
  try {
    const d = JSON.parse(fs.readFileSync(storePath(home), 'utf8'));
    return d && typeof d.key === 'string' ? d : null;
  } catch {
    return null;
  }
}

function saveStored(home, data) {
  writePrivate(storePath(home), JSON.stringify(data, null, 2));
}

async function post(api, route, body, fetchImpl) {
  const res = await fetchImpl(`${api}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'psyseal' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  return { ok: res.ok, status: res.status, json };
}

function grantedNow(lic, now) {
  if (!lic || lic.status !== 'granted') return false;
  if (lic.expires_at && Date.parse(lic.expires_at) <= now) return false;
  return true;
}

/**
 * Valida la licencia y la activa en cada agente que lo necesite.
 * @param {{ home: string, key?: string, agents: Array<{ hash?: string, ref?: object, label: string }>, env?: object, fetchImpl?: Function, now?: number }} o
 *   Cada agente trae su huella (`hash`) o sus datos (`ref`) para calcularla después de validar la clave.
 * @returns {Promise<{ ok: false, reason: 'not-configured'|'no-key'|'bad-format'|'invalid'|'expired'|'network' }
 *   | { ok: true, key: string, limit: number|null, licensed: Map<string, string|null>, refused: string[] }>}
 */
export async function checkLicense({ home, key, agents = [], env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const cfg = licenseConfig(env);
  if (!cfg.organizationId || !cfg.api) return { ok: false, reason: 'not-configured' };
  const stored = loadStored(home);
  const useKey = (key || stored?.key || '').trim();
  if (!useKey) return { ok: false, reason: 'no-key' };
  if (!KEY_RE.test(useKey)) return { ok: false, reason: 'bad-format' };
  const org = cfg.organizationId;
  const activations = stored && stored.key === useKey && stored.activations && typeof stored.activations === 'object' ? { ...stored.activations } : {};

  try {
    const v0 = await post(cfg.api, '/v1/customer-portal/license-keys/validate', { key: useKey, organization_id: org }, fetchImpl);
    if (!v0.ok) return { ok: false, reason: v0.status === 404 || v0.status === 422 || v0.status === 400 ? 'invalid' : 'network' };
    if (!grantedNow(v0.json, now)) return { ok: false, reason: v0.json?.expires_at && Date.parse(v0.json.expires_at) <= now ? 'expired' : 'invalid' };
    const limit = Number.isInteger(v0.json.limit_activations) ? v0.json.limit_activations : null;
    // La huella se calcula hasta aquí: con una clave mala no se escribe nada en este equipo.
    for (const a of agents) if (!a.hash && a.ref) a.hash = agentHash(home, a.ref);
    const licensed = new Map();
    const refused = [];

    for (const a of agents) {
      if (limit === null) {
        licensed.set(a.hash, null);
        continue;
      }
      const known = activations[a.hash];
      if (known && UUID_RE.test(known)) {
        const v = await post(cfg.api, '/v1/customer-portal/license-keys/validate', { key: useKey, organization_id: org, activation_id: known, conditions: { agent: a.hash } }, fetchImpl);
        if (v.ok && grantedNow(v.json, now)) {
          licensed.set(a.hash, known);
          continue;
        }
        if (v.status !== 404) return { ok: false, reason: v.ok ? 'invalid' : 'network' };
        delete activations[a.hash]; // la liberaste en tu portal: se vuelve a activar si hay lugar
      }
      const r = await post(cfg.api, '/v1/customer-portal/license-keys/activate', { key: useKey, organization_id: org, label: a.label, conditions: { agent: a.hash } }, fetchImpl);
      if (r.ok && r.json?.id) {
        activations[a.hash] = r.json.id;
        licensed.set(a.hash, r.json.id);
      } else if (r.status === 403) refused.push(a.hash);
      else return { ok: false, reason: r.status === 404 ? 'invalid' : 'network' };
    }
    saveStored(home, { key: useKey, activations, validatedAt: new Date(now).toISOString() });
    return { ok: true, key: useKey, limit, licensed, refused };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
