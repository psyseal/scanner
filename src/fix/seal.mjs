// Sello de Psyseal: convierte el reporte del escáner en el resultado de cinco revisiones y lo manda a firmar.
// Lo que se envía por agente: el código seudónimo del agente, su plataforma, el nombre público que elijas (opcional),
// la versión del programa, una huella de sus archivos y el resultado de cada revisión (pasó, mejorable, no pasó).
// Nunca se envía el contenido de los archivos, nombres de carpetas ni hallazgos detallados.

import { SEAL } from '../brand.mjs';

export const CHECKS = ['secrets', 'injection', 'permissions', 'memory', 'schedules'];

const MEMORY_IDS = new Set(['memory.over_limit', 'memory.near_full', 'memory.bloat', 'bootstrap.file_truncated', 'bootstrap.file_cut_by_total', 'bootstrap.near_cap', 'weight.heavy_file', 'bootstrap.leftover']);
const SCHEDULE_IDS = new Set(['schedule.frequent', 'heartbeat.full_history', 'heartbeat.bootstrap_each_run', 'heartbeat.cache_expires', 'heartbeat.no_active_hours', 'heartbeat.expensive_model']);

/** Resultado de cada revisión para un agente (incluye lo de su instalación, como el .env compartido). */
export function sealChecks(agent, globalFindings = [], { platformOs = process.platform } = {}) {
  const own = agent.findings || [];
  const shared = globalFindings.filter((f) => (f.data?.platform || 'openclaw') === agent.platform);
  const all = [...own, ...shared].filter((f) => f.severity !== 'info');
  const has = (pred) => all.some(pred);
  const checks = {};
  checks.secrets = has((f) => f.id === 'secret.exposed') ? 'fail' : has((f) => f.id === 'config.secret_plaintext') ? 'warn' : 'pass';
  checks.injection = has((f) => f.id.startsWith('inject.') && f.severity === 'high') ? 'fail' : has((f) => f.id.startsWith('inject.')) ? 'warn' : 'pass';
  if (platformOs === 'win32') checks.permissions = 'na';
  else checks.permissions = has((f) => f.id === 'perm.secret_file_open') ? 'fail' : 'pass';
  checks.memory = has((f) => MEMORY_IDS.has(f.id)) ? 'warn' : 'pass';
  checks.schedules = has((f) => SCHEDULE_IDS.has(f.id)) ? 'warn' : 'pass';
  return checks;
}

export function sealApi(env = process.env) {
  return (env.PSYSEAL_SEAL_API || SEAL.api).replace(/\/+$/, '');
}

/** Pide el sello. Devuelve { status, json, headers } o { status: 0 } si no hubo conexión. */
export async function requestSeal(body, { env = process.env, fetchImpl = globalThis.fetch, route = '/api/seal' } = {}) {
  try {
    const res = await fetchImpl(sealApi(env) + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'psyseal' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* sin JSON */
    }
    return { status: res.status, json, headers: res.headers };
  } catch {
    return { status: 0, json: null };
  }
}

export function cleanName(s) {
  if (s == null) return null;
  const t = String(s).normalize('NFKC').replace(/[^\p{L}\p{N} @._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  return t || null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const SEAL_T = {
  es: {
    header: (v, dry) => `PSYSEAL SEAL v${v} — ${dry ? 'prueba: muestra lo que se enviaría y no envía nada' : 'sello de tus agentes'}`,
    sends: 'Por cada agente se envía solo esto, nunca el contenido de tus archivos (aviso de privacidad: https://psyseal.com/privacidad):',
    none: 'No encontré agentes para sellar. Usa --path <carpeta de tu agente> si está en otra parte.',
    checkName: { secrets: 'claves expuestas', injection: 'instrucciones inyectadas', permissions: 'permisos de credenciales', memory: 'memoria', schedules: 'tareas programadas' },
    value: { pass: 'pasó', warn: 'mejorable', fail: 'no pasó', na: 'no aplica en este sistema' },
    sealed: (tag, date) => `✓ ${tag}: sello vigente hasta el ${date}.`,
    link: (url) => `   Página pública: ${url}`,
    badge: (md) => `   Insignia: pega esta línea en el README.md de tu agente (arriba del todo, si está en GitHub) o en su perfil: ${md}`,
    check: (url) => `   Para ver que sigue vigente, abre ${url}: arriba dice si está vigente y hasta cuándo, y la insignia cambia sola si se suspende o vence.`,
    guide: 'Guía paso a paso (dónde poner la insignia, cómo comprobarla y renovarla): https://psyseal.com/guia',
    failed: (tag, list) => `✗ ${tag}: no pasó ${list}. Corre "node scripts/psyseal-fix.mjs --apply" y vuelve a pedir el sello.`,
    suspended: (url) => `   Su sello quedó suspendido hasta que pase: ${url}`,
    noSeal: (tag) => `✗ ${tag}: tu plan no incluye el sello.`,
    refused: (tag, limit, portal) => `✗ ${tag}: tu plan cubre ${plural(limit, 'agente', 'agentes')} y ya están en uso. Libera uno en ${portal} o cambia a un plan con más agentes.`,
    rate: 'Pediste demasiados sellos hoy con esta licencia (máximo 40 al día). El conteo se reinicia a las 00:00 UTC, las 18:00 de la Ciudad de México.',
    blocked: (tag, reason, url) =>
      reason === 'seal_voided'
        ? `✗ ${tag}: este sello fue anulado de forma permanente (${url}). Si crees que es un error, escríbenos a hola@psyseal.com.`
        : reason === 'seal_under_review'
          ? `✗ ${tag}: este sello está suspendido mientras revisamos un reporte, como máximo 10 días hábiles (${url}). Puedes responder a hola@psyseal.com.`
          : `✗ ${tag}: el nombre público de este sello no cumple los Términos. Pídelo de nuevo con otro nombre: --name <nuevo nombre>.`,
    licenseBad: (url) => `El servicio del sello no aceptó tu licencia: puede que el plan ya no esté pagado. Revisa en ${url}.`,
    network: 'No pude conectar con el servicio del sello. No se envió nada más; intenta de nuevo.',
    renew: 'El sello se renueva cada vez que corres este comando y las revisiones pasan; vence a los 30 días de la última revisión que pasó o al terminar el periodo que pagaste, lo que ocurra primero. Córrelo cada semana, o deja que tu agente lo corra.',
    x402Paid: (tag, date) => `✓ ${tag}: sello pagado y vigente hasta el ${date}. Las revisiones hasta esa fecha no se cobran.`,
    x402Need: (tag, price, net) => `$ ${tag}: el sello cuesta ${price} en ${net} por 30 días, y lo paga el propio agente con x402.`,
    x402How: (url, file) => `   Con autorización de su dueño, el agente hace POST a ${url} con el cuerpo guardado en ${file} y paga con su cliente x402. Al pagar aceptas los Términos: https://psyseal.com/terminos (aviso de privacidad: https://psyseal.com/privacidad)`,
    x402Off: 'El pago con x402 todavía no está abierto. Usa un plan de psyseal.com.',
    x402NotHere: (c) => `El pago con x402 no está disponible desde tu país (${c}). Puedes contratar un plan con tarjeta en https://psyseal.com/#planes`,
    x402License: (tag) => `✗ ${tag}: este agente tiene sello por plan. Corre psyseal-seal sin --x402.`,
    x402Full: (price) => `   Con el pase completo (${price} por 30 días, incluye el sello) la limpieza lo arregla: node scripts/psyseal-fix.mjs --apply --x402`,
    netName: { 'eip155:8453': 'USDC en Base', 'eip155:84532': 'USDC de prueba en Base Sepolia' },
  },
  en: {
    header: (v, dry) => `PSYSEAL SEAL v${v} — ${dry ? 'dry run: shows what would be sent and sends nothing' : 'seal for your agents'}`,
    sends: 'For each agent only this is sent, never the content of your files (privacy notice: https://psyseal.com/privacidad):',
    none: 'I found no agents to seal. Use --path <your agent folder> if it lives elsewhere.',
    checkName: { secrets: 'exposed keys', injection: 'injected instructions', permissions: 'credential permissions', memory: 'memory', schedules: 'scheduled tasks' },
    value: { pass: 'passed', warn: 'could improve', fail: 'failed', na: 'not applicable on this system' },
    sealed: (tag, date) => `✓ ${tag}: seal valid until ${date}.`,
    link: (url) => `   Public page: ${url}`,
    badge: (md) => `   Badge: paste this line in your agent's README.md (at the very top, if it lives on GitHub) or in its profile: ${md}`,
    check: (url) => `   To see that it is still valid, open ${url}: the top says whether it is valid and until when, and the badge changes by itself if it is suspended or expires.`,
    guide: 'Step-by-step guide (where to put the badge, how to check and renew it): https://psyseal.com/guia',
    failed: (tag, list) => `✗ ${tag}: failed ${list}. Run "node scripts/psyseal-fix.mjs --apply" and request the seal again.`,
    suspended: (url) => `   Its seal is suspended until it passes: ${url}`,
    noSeal: (tag) => `✗ ${tag}: your plan does not include the seal.`,
    refused: (tag, limit, portal) => `✗ ${tag}: your plan covers ${plural(limit, 'agent', 'agents')} and they are all in use. Free one at ${portal} or move to a plan with more agents.`,
    rate: 'You requested too many seals today with this license (40 a day at most). The count resets at 00:00 UTC.',
    blocked: (tag, reason, url) =>
      reason === 'seal_voided'
        ? `✗ ${tag}: this seal was voided permanently (${url}). If you think it is a mistake, write to hola@psyseal.com.`
        : reason === 'seal_under_review'
          ? `✗ ${tag}: this seal is suspended while we review a report, for 10 business days at most (${url}). You can reply to hola@psyseal.com.`
          : `✗ ${tag}: this seal's public name does not comply with the Terms. Request it again with another name: --name <new name>.`,
    licenseBad: (url) => `The seal service did not accept your license: the plan may no longer be paid. Check at ${url}.`,
    network: 'I could not reach the seal service. Nothing else was sent; try again.',
    renew: 'The seal renews every time you run this command and the checks pass; it expires 30 days after the last check that passed or at the end of the period you paid for, whichever comes first. Run it every week, or let your agent run it.',
    x402Paid: (tag, date) => `✓ ${tag}: seal paid and valid until ${date}. Checks until then are free.`,
    x402Need: (tag, price, net) => `$ ${tag}: the seal costs ${price} on ${net} for 30 days, paid by the agent itself with x402.`,
    x402How: (url, file) => `   With its owner's authorization, the agent POSTs to ${url} with the body saved in ${file} and pays with its x402 client. By paying you accept the Terms: https://psyseal.com/terminos (privacy notice: https://psyseal.com/privacidad)`,
    x402Off: 'Paying with x402 is not open yet. Use a plan from psyseal.com.',
    x402NotHere: (c) => `Paying with x402 is not available from your country (${c}). You can buy a card plan at https://psyseal.com/#planes`,
    x402License: (tag) => `✗ ${tag}: this agent has a plan-based seal. Run psyseal-seal without --x402.`,
    x402Full: (price) => `   With the full pass (${price} for 30 days, seal included) the cleanup fixes it: node scripts/psyseal-fix.mjs --apply --x402 --lang en`,
    netName: { 'eip155:8453': 'USDC on Base', 'eip155:84532': 'test USDC on Base Sepolia' },
  },
};
