#!/usr/bin/env node
// CLI de psyseal-seal: revisa tus agentes y pide su sello firmado. Necesita una licencia.
// Conexiones: la API de licencias de Polar y el servicio del sello de Psyseal. Solo envía resultados y huellas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScan, VERSION } from '../src/scan.mjs';
import { toAscii } from '../src/report.mjs';
import { PLATFORM_IDS } from '../src/platforms/index.mjs';
import { FIX } from '../src/fix/i18n.mjs';
import { agentHash, agentLabel, checkLicense, licenseConfig } from '../src/fix/license.mjs';
import { CHECKS, SEAL_T, cleanName, requestSeal, sealApi, sealChecks } from '../src/fix/seal.mjs';
import { psysealDir } from '../src/fix/backup.mjs';

const HELP = {
  es: `psyseal-seal v${VERSION} — sello firmado para tus agentes de IA (cualquiera puede comprobar la firma)

Uso: node scripts/psyseal-seal.mjs [opciones]

  (sin opciones)           Revisa tus agentes y pide su sello (necesita licencia)
  --dry-run                Muestra exactamente qué se enviaría, sin enviar nada
  --x402                   Sin plan: el propio agente paga su sello en USDC (x402). Prepara el pedido para su cartera
  --name <texto>           Nombre público que aparece en el sello (opcional, máximo 32 caracteres)
  --key <clave>            Tu clave de licencia (se guarda en ~/.psyseal/license.json)
  --path, --platform, --agent, --workspace, --config   Igual que en psyseal-scan
  --lang <es|en>, --ascii

Códigos de salida: 0 todos sellados · 1 alguno no pasó · 2 error de uso · 3 problema con la licencia · 4 falta el pago x402 · 5 sin conexión.
`,
  en: `psyseal-seal v${VERSION} — signed seal for your AI agents (anyone can check the signature)

Usage: node scripts/psyseal-seal.mjs [options]

  (no options)             Check your agents and request their seal (needs a license)
  --dry-run                Show exactly what would be sent, without sending anything
  --x402                   No plan: the agent pays for its own seal in USDC (x402). Prepares the request for its wallet
  --name <text>            Public name shown on the seal (optional, up to 32 characters)
  --key <key>              Your license key (stored in ~/.psyseal/license.json)
  --path, --platform, --agent, --workspace, --config   Same as psyseal-scan
  --lang <es|en>, --ascii

Exit codes: 0 all sealed · 1 some failed · 2 usage error · 3 license problem · 4 x402 payment needed · 5 offline.
`,
};

function guessLang(env) {
  const v = String(env.PSYSEAL_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '').toLowerCase();
  return v.startsWith('en') ? 'en' : 'es';
}

function parseArgs(argv, env) {
  const o = { lang: guessLang(env), ascii: env.PSYSEAL_ASCII === '1' };
  const flags = { '--dry-run': 'dryRun', '--ascii': 'ascii', '--x402': 'x402' };
  const values = new Set(['--key', '--name', '--path', '--platform', '--agent', '--workspace', '--config', '--lang']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const key = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    let val = a.startsWith('--') && eq > 0 ? a.slice(eq + 1) : undefined;
    if (key === '-h' || key === '--help') o.help = true;
    else if (flags[key]) o[flags[key]] = true;
    else if (values.has(key)) {
      if (val === undefined) val = argv[++i];
      if (val === undefined || val.startsWith('--')) throw new Error(`Falta el valor de ${key}`);
      o[key.slice(2)] = val;
    } else throw new Error(`Opción desconocida: ${a}`);
  }
  return o;
}

const day = (iso, lang) => {
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
};

/** Sello pagado por el propio agente: este programa no maneja carteras; prepara el pedido y el agente paga. */
async function sealWithX402({ agents, home, name, out, S, lang, env }) {
  const route = '/api/x402/seal';
  let failedAny = false;
  let needPay = false;
  for (const a of agents) {
    a.hash = agentHash(home, a.ref);
    const body = { agent: { hash: a.hash, platform: a.platform, ...(name ? { label: name } : {}) }, scanner: VERSION, state_hash: a.fingerprint, checks: a.checks };
    const r = await requestSeal(body, { env, route });
    if (r.status === 200 && r.json?.ok) {
      out(S.x402Paid(a.tag, day(r.json.expires_at, lang)));
      out(S.link(r.json.url));
      out(S.badge(`[![Psyseal](${r.json.badge})](${r.json.url})`));
      out(S.check(r.json.url));
    } else if (r.status === 402) {
      needPay = true;
      const dir = path.join(psysealDir(home), 'x402');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${a.platform}-${a.hash.slice(0, 12)}.json`);
      fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
      out(S.x402Need(a.tag, r.json?.price || 'USDC', S.netName[r.json?.network] || r.json?.network || 'USDC'));
      out(S.x402How(sealApi(env) + route, file));
    } else if (r.status === 422) {
      failedAny = true;
      out(S.failed(a.tag, (r.json?.failed || []).map((n) => S.checkName[n] || n).join(', ')));
      if (r.json?.url) out(S.suspended(r.json.url));
      if (r.json?.full_price) out(S.x402Full(r.json.full_price));
    } else if (r.status === 409) {
      failedAny = true;
      out(S.x402License(a.tag));
    } else if (r.status === 403 && String(r.json?.reason || '').startsWith('seal_')) {
      failedAny = true;
      out(S.blocked(a.tag, r.json.reason, r.json.url));
    } else if (r.status === 503) {
      out(S.x402Off);
      return 3;
    } else if (r.status === 451) {
      out(S.x402NotHere(r.json?.country || '?'));
      return 3;
    } else {
      out(S.network);
      return 5;
    }
  }
  return failedAny ? 1 : needPay ? 4 : 0;
}

async function main() {
  const env = process.env;
  let args;
  try {
    args = parseArgs(process.argv.slice(2), env);
    if (!['es', 'en'].includes(args.lang)) throw new Error('--lang debe ser es o en');
    if (args.platform && !PLATFORM_IDS.includes(args.platform)) throw new Error(`--platform debe ser uno de: ${PLATFORM_IDS.join(', ')}`);
  } catch (e) {
    process.stderr.write(`${e.message}\n\n${HELP[guessLang(env)]}`);
    return 2;
  }
  const S = SEAL_T[args.lang];
  const L = FIX[args.lang].license;
  const out = (s = '') => process.stdout.write((args.ascii ? toAscii(s) : s) + '\n');
  if (args.help) {
    process.stdout.write(HELP[args.lang]);
    return 0;
  }
  const home = os.homedir();
  const name = cleanName(args.name);
  const report = runScan({ env, path: args.path, platform: args.platform, agent: args.agent, workspace: args.workspace, config: args.config });
  out(S.header(VERSION, !!args.dryRun));
  out('');
  const agents = (report.agents || [])
    .filter((a) => a.workspaceExists !== false)
    .map((a) => ({
      tag: `${a.platformName} · ${a.id}`,
      ref: { platform: a.platform, platformName: a.platformName, id: a.id, root: a.root || a.workspace },
      label: agentLabel({ platform: a.platform, platformName: a.platformName, id: a.id }),
      platform: a.platform,
      fingerprint: a.fingerprint,
      checks: sealChecks(a, report.globalFindings),
    }));
  if (!agents.length) {
    out(S.none);
    return 2;
  }
  const checkLine = (c) => CHECKS.map((n) => `${S.checkName[n]}: ${S.value[c[n]]}`).join(' · ');

  if (args.dryRun) {
    out(S.sends);
    for (const a of agents) {
      out('');
      out(`${a.tag} — ${checkLine(a.checks)}`);
      const body = { key: '<tu clave>', activation_id: '<se asigna al activar>', agent: { hash: agentHash(home, a.ref), platform: a.platform, ...(name ? { label: name } : {}) }, scanner: VERSION, state_hash: a.fingerprint, checks: a.checks };
      out(JSON.stringify(body, null, 2));
    }
    return 0;
  }

  if (args.x402) return sealWithX402({ agents, home, name, out, S, lang: args.lang, env });

  const lic = licenseConfig(env);
  const check = await checkLicense({ home, key: args.key, env, agents });
  if (!check.ok) {
    const msg = L[check.reason];
    out(typeof msg === 'function' ? msg(lic.checkoutUrl) : msg);
    return check.reason === 'network' ? 5 : 3;
  }

  let failedAny = false;
  for (const a of agents) {
    if (check.refused.includes(a.hash)) {
      out(S.refused(a.tag, check.limit, lic.portalUrl));
      failedAny = true;
      continue;
    }
    const activationId = check.licensed.get(a.hash);
    if (!activationId) {
      out(S.noSeal(a.tag));
      failedAny = true;
      continue;
    }
    const r = await requestSeal({ key: check.key, activation_id: activationId, agent: { hash: a.hash, platform: a.platform, ...(name ? { label: name } : {}) }, scanner: VERSION, state_hash: a.fingerprint, checks: a.checks }, { env });
    if (r.status === 200 && r.json?.ok) {
      out(S.sealed(a.tag, day(r.json.expires_at, args.lang)));
      out(S.link(r.json.url));
      out(S.badge(`[![Psyseal](${r.json.badge})](${r.json.url})`));
      out(S.check(r.json.url));
    } else if (r.status === 422) {
      failedAny = true;
      out(S.failed(a.tag, (r.json?.failed || []).map((n) => S.checkName[n] || n).join(', ')));
      if (r.json?.url) out(S.suspended(r.json.url));
    } else if (r.status === 429) {
      out(S.rate);
      return 3;
    } else if (r.status === 403 && String(r.json?.reason || '').startsWith('seal_')) {
      failedAny = true;
      out(S.blocked(a.tag, r.json.reason, r.json.url));
    } else if (r.status === 403) {
      out(S.licenseBad(lic.portalUrl));
      return 3;
    } else {
      out(S.network);
      return 5;
    }
  }
  out('');
  out(S.renew);
  out(S.guide);
  return failedAny ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`Error: ${e?.message || e}\n`);
    process.exitCode = 1;
  },
);
