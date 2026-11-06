// Pase completo pagado por el propio agente con x402 (limpieza + sello por 30 días).
// Este programa no maneja carteras: pregunta al servicio del sello si el agente tiene un pase vigente y, si no,
// guarda el pedido para que el agente lo pague con su propio cliente x402 (solo con autorización de su dueño).
// Lo que se envía por agente: su código seudónimo y su plataforma. Nada del contenido.

import fs from 'node:fs';
import path from 'node:path';
import { psysealDir } from './backup.mjs';
import { agentHash } from './license.mjs';
import { requestSeal, sealApi } from './seal.mjs';

export const PASS_ROUTE = '/api/x402/pass';

/**
 * @param {{ agents: Array<{ ref: object, tag: string }>, home: string, env?: object }} o
 * @returns {Promise<{ off?: true, notHere?: string, network?: true, licensed: Map<string, string>, needPay: Array<{ tag, file, price, network }>, licenseSeal: string[], blocked: Array<{ tag, reason, url }> }>}
 */
export async function x402FullAccess({ agents, home, env = process.env }) {
  const licensed = new Map();
  const needPay = [];
  const licenseSeal = [];
  const blocked = []; // sello anulado o en revisión: no se vende el pase
  for (const a of agents) {
    a.hash = a.hash || agentHash(home, a.ref);
    const body = { agent: { hash: a.hash, platform: a.ref.platform }, tier: 'full' };
    const r = await requestSeal(body, { env, route: PASS_ROUTE });
    if (r.status === 200 && r.json?.ok) licensed.set(a.hash, r.json.paid_until);
    else if (r.status === 402) {
      const dir = path.join(psysealDir(home), 'x402');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${a.ref.platform}-${a.hash.slice(0, 12)}-full.json`);
      fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
      needPay.push({ tag: a.tag, file, price: r.json?.price || 'USDC', network: r.json?.network || '' });
    } else if (r.status === 409) licenseSeal.push(a.tag);
    else if (r.status === 403 && String(r.json?.reason || '').startsWith('seal_')) blocked.push({ tag: a.tag, reason: r.json.reason, url: r.json.url });
    else if (r.status === 503) return { off: true, licensed, needPay, licenseSeal, blocked };
    else if (r.status === 451) return { notHere: r.json?.country || '?', licensed, needPay, licenseSeal, blocked };
    else return { network: true, licensed, needPay, licenseSeal, blocked };
  }
  return { licensed, needPay, licenseSeal, blocked, url: sealApi(env) + PASS_ROUTE };
}
