#!/usr/bin/env node
// CLI de psyseal-fix: limpieza de tus agentes con respaldo y tu aprobación en cada cambio.
// Sin --apply solo muestra la vista previa. La única conexión a internet es la validación de la licencia.
import os from 'node:os';
import readline from 'node:readline/promises';
import { runScan, VERSION } from '../src/scan.mjs';
import { toAscii } from '../src/report.mjs';
import { PLATFORM_IDS } from '../src/platforms/index.mjs';
import { FIX } from '../src/fix/i18n.mjs';
import { applyPlan, buildPlan, previewAction } from '../src/fix/plan.mjs';
import { agentLabel, checkLicense, licenseConfig } from '../src/fix/license.mjs';
import { listBackups, undoBackup } from '../src/fix/backup.mjs';
import { countFixable } from '../src/fixable.mjs';
import { x402FullAccess } from '../src/fix/x402.mjs';

const HELP = {
  es: `psyseal-fix v${VERSION} — limpieza de tus agentes de IA con respaldo y tu aprobación

Uso: node scripts/psyseal-fix.mjs [opciones]

  (sin opciones)           Vista previa: qué cambiaría. No toca nada y no necesita licencia.
  --apply                  Aplica los cambios que apruebes uno por uno (necesita licencia)
  --all                    Con --apply: aprueba todos los cambios de la vista previa sin preguntar
  --x402                   Con --apply, sin plan: usa el pase completo que paga el propio agente en USDC (x402)
  --key <clave>            Tu clave de licencia (se guarda en ~/.psyseal/license.json)
  --undo <id>              Deshace una limpieza usando su respaldo (no necesita licencia)
  --force                  Con --undo: restaura aunque el archivo haya cambiado después
  --list-backups           Lista los respaldos
  --path, --platform, --agent, --workspace, --config   Igual que en psyseal-scan
  --lang <es|en>, --ascii

Códigos de salida: 0 bien · 2 error de uso · 3 problema con la licencia · 4 algún cambio falló o falta el pago x402 · 5 sin conexión.
`,
  en: `psyseal-fix v${VERSION} — cleanup of your AI agents with a backup and your approval

Usage: node scripts/psyseal-fix.mjs [options]

  (no options)             Preview: what would change. Touches nothing and needs no license.
  --apply                  Apply the changes you approve one by one (needs a license)
  --all                    With --apply: approve every change in the preview without asking
  --x402                   With --apply, no plan: use the full pass the agent pays for in USDC (x402)
  --key <key>              Your license key (stored in ~/.psyseal/license.json)
  --undo <id>              Undo a cleanup from its backup (needs no license)
  --force                  With --undo: restore even if the file changed afterwards
  --list-backups           List backups
  --path, --platform, --agent, --workspace, --config   Same as psyseal-scan
  --lang <es|en>, --ascii

Exit codes: 0 ok · 2 usage error · 3 license problem · 4 some change failed or x402 payment needed · 5 offline.
`,
};

function guessLang(env) {
  const v = String(env.PSYSEAL_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || '').toLowerCase();
  return v.startsWith('en') ? 'en' : 'es';
}

function parseArgs(argv, env) {
  const o = { lang: guessLang(env), ascii: env.PSYSEAL_ASCII === '1' };
  const flags = { '--apply': 'apply', '--all': 'all', '--force': 'force', '--list-backups': 'listBackups', '--ascii': 'ascii', '--x402': 'x402' };
  const values = new Set(['--key', '--undo', '--path', '--platform', '--agent', '--workspace', '--config', '--lang']);
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
  const T = FIX[args.lang];
  const out = (s = '') => process.stdout.write((args.ascii ? toAscii(s) : s) + '\n');
  if (args.help) {
    process.stdout.write(HELP[args.lang]);
    return 0;
  }
  const home = os.homedir();

  if (args.listBackups) {
    const list = listBackups(home);
    out(list.length ? T.backups : T.noBackups);
    for (const b of list) out(`  ${b.id}  ${b.createdAt || ''}  (${b.files})`);
    return 0;
  }
  if (args.undo) {
    try {
      const r = undoBackup(home, args.undo, { force: !!args.force });
      out(T.undone(r.restored.length));
      for (const s of r.skipped) out('  ' + T.undoSkipped(s.path, s.reason));
      return r.skipped.length ? 4 : 0;
    } catch {
      out(T.badUndo);
      return 2;
    }
  }

  const scanOpts = { env, path: args.path, platform: args.platform, agent: args.agent, workspace: args.workspace, config: args.config };
  const report = runScan(scanOpts);
  out(T.header(VERSION, !!args.apply));
  out('');
  const plan = buildPlan(report)
    .map((a) => ({ ...a, preview: previewAction(a, { env, T, home }) }))
    .filter((a) => a.preview.ok);
  if (!plan.length) {
    out(T.none);
    return 0;
  }

  out(T.planTitle(plan.length));
  plan.forEach((a, i) => {
    out(`  ${i + 1}. [${a.agentTag}] ${T.action[a.op](a.preview.params)} (${T.risk[a.risk]})`);
    if (a.preview.manual) {
      out(`     ${T.noCli}`);
      for (const c of a.preview.commands) out(`     ${T.manual(c)}`);
    }
  });
  out('');

  const lic = licenseConfig(env);
  if (!args.apply) {
    out(lic.organizationId ? T.toApply(lic.checkoutUrl) : T.previewOnly);
    return 0;
  }

  const agents = [];
  const keyOf = (ag) => `${ag.platform}|${ag.root}|${ag.id}`;
  for (const a of plan) {
    if (!a.agent) continue;
    if (!agents.some((x) => x.k === keyOf(a.agent))) agents.push({ k: keyOf(a.agent), ref: a.agent, label: agentLabel(a.agent), tag: a.agentTag });
  }
  let licensedHashes;
  if (args.x402) {
    // Sin plan: el pase completo que paga el propio agente habilita la limpieza de ese agente por 30 días.
    const acc = await x402FullAccess({ agents, home, env });
    if (acc.off) {
      out(T.x402Off);
      return 3;
    }
    if (acc.notHere) {
      out(T.x402NotHere(acc.notHere));
      return 3;
    }
    if (acc.network) {
      out(T.license.network);
      return 5;
    }
    for (const a of agents) if (acc.licensed.has(a.hash)) out(T.x402Ok(a.tag, String(acc.licensed.get(a.hash)).slice(0, 10)));
    for (const n of acc.needPay) {
      out(T.x402Need(n.tag, n.price));
      out(T.x402How(acc.url, n.file));
    }
    for (const t of acc.licenseSeal) out(T.x402License(t));
    for (const b of acc.blocked || []) out(T.x402Blocked(b.tag, b.reason, b.url));
    out('');
    licensedHashes = new Set(acc.licensed.keys());
    if (!licensedHashes.size) return acc.needPay.length ? 4 : 3;
  } else {
    // Cada agente usa una activación de tu plan: se calcula su código seudónimo y se valida con Polar.
    const check = await checkLicense({ home, key: args.key, env, agents });
    if (!check.ok) {
      const msg = T.license[check.reason];
      out(typeof msg === 'function' ? msg(lic.checkoutUrl) : msg);
      return 3;
    }
    out(T.licenseOk(check.limit, check.licensed.size));
    for (const h of check.refused) out('  ' + T.refused(agents.find((x) => x.hash === h).tag, check.limit, lic.portalUrl));
    out('');
    licensedHashes = new Set(check.licensed.keys());
    if (!licensedHashes.size) return check.refused.length ? 3 : 0;
  }
  for (const a of plan) if (a.agent) a.agentHash = agents.find((x) => x.k === keyOf(a.agent))?.hash;
  const covered = plan.filter((a) => a.agentHash && licensedHashes.has(a.agentHash));
  if (!covered.length) return 0;

  const applicable = covered.filter((a) => !a.preview.manual);
  let approved = [];
  if (args.all) approved = applicable;
  else {
    if (!process.stdin.isTTY) {
      out(T.needTty);
      return 2;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (const a of applicable) {
        out(`${plan.indexOf(a) + 1}. ${T.action[a.op](a.preview.params)}`);
        const ans = await rl.question(args.ascii ? toAscii(T.ask) : T.ask);
        if (T.yes.test(ans.trim())) approved.push(a);
      }
    } finally {
      rl.close();
    }
  }
  if (!approved.length) return 0;

  const before = countFixable(report);
  const res = applyPlan(approved, { home, env });
  out('');
  for (const r of res.results) out(`  ${r.status === 'applied' ? T.applied : T.failed(r.error)} — ${T.action[r.action.op](r.action.preview.params)}`);
  const after = countFixable(runScan(scanOpts));
  out('');
  out(T.verify(before, after));
  if (res.redacted > 0) out(T.rotate);
  out(T.backupAt(res.backup.id, res.backup.dir));
  out(T.undoHint(res.backup.id));
  return res.results.some((r) => r.status === 'failed') ? 4 : 0;
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
