---
name: psyseal-scan
description: "Offline, read-only scan of your AI agent (OpenClaw, Hermes Agent, nanobot, PicoClaw, ZeroClaw, NanoClaw or any agent folder): what loads on every message, scheduled-task cost, plaintext secrets, poisoned or bloated memory."
metadata:
  openclaw:
    emoji: "🩺"
    requires:
      bins:
        - node
    envVars:
      - name: OPENCLAW_CONFIG_PATH
        required: false
        description: "Alternative path to openclaw.json (read only)."
      - name: OPENCLAW_STATE_DIR
        required: false
        description: "Alternative OpenClaw state directory (read only)."
      - name: OPENCLAW_PROFILE
        required: false
        description: "Profile name; selects the ~/.openclaw-<profile> state directory (read only)."
      - name: OPENCLAW_WORKSPACE_DIR
        required: false
        description: "Alternative workspace directory (read only)."
      - name: OPENCLAW_INCLUDE_ROOTS
        required: false
        description: "Extra directories allowed for $include files in the config (read only)."
      - name: OPENCLAW_CACHE_RETENTION
        required: false
        description: "If set to long, the heartbeat estimate assumes a 1-hour prompt cache."
      - name: HERMES_HOME
        required: false
        description: "Alternative Hermes Agent home (read only)."
      - name: PICOCLAW_HOME
        required: false
        description: "Alternative PicoClaw home (read only)."
      - name: PICOCLAW_CONFIG
        required: false
        description: "Alternative PicoClaw config file (read only)."
      - name: ZEROCLAW_CONFIG_DIR
        required: false
        description: "Alternative ZeroClaw config directory (read only)."
      - name: NANOCLAW_DIR
        required: false
        description: "Folder of a NanoClaw install (read only)."
      - name: PSYSEAL_LANG
        required: false
        description: "Report language, es or en."
      - name: PSYSEAL_ASCII
        required: false
        description: "Set to 1 for plain ASCII output."
---

# psyseal-scan

Offline, read-only review of the AI agents on this machine. Every finding comes with a concrete fix. It checks:

1. **What loads on every message** - size of the instruction and memory files, and which ones get cut silently.
2. **Scheduled tasks and heartbeats** - runs per day and monthly cost (tokens, and dollars when the model price is known).
3. **Plaintext secrets** in memory, instructions and skills, plus credential files other users can read - reported as type, file and line only, never the value.
4. **Planted or bloated memory** - text that looks like a planted instruction, invisible characters, repeated lines and giant blobs.

## When to use it

The owner asks to check or clean the agent's memory, to understand a high bill, to check for leaked keys, or to check whether memory was tampered with.

## Run

```bash
node {baseDir}/scripts/psyseal-scan.mjs --lang en --exit-zero
```

Optional flags: `--path <folder>`, `--platform <id>`, `--agent <id>`, `--json`. See `--help`.

## Rules for the agent

- Show the owner the report as printed. Do not restate the figures from memory: they are estimates.
- The report never contains secret values or memory text, on purpose. Do not open the flagged lines and paste them into the chat; give the owner the file and line so they open it themselves.
- Do not edit config, delete or rewrite memory, or rotate keys on your own. Offer each fix and wait for the owner's explicit OK.
- Never run `psyseal-fix --apply` yourself. The cleanup is for the owner to run in their own terminal, approving each change.
- If the owner has a Psyseal plan and asks you to keep the seal current, you may run `node {baseDir}/scripts/psyseal-seal.mjs --lang en` on a weekly schedule. It only reads files and sends the check results (never file content). Report the result to the owner; never try to make a failing check pass by editing files yourself.
- Without a plan, you, the agent, can pay in USDC with x402. **Only pay if the owner has explicitly authorized you to spend from a specific wallet for this.**
  - Seal only (agent already passes): run `node {baseDir}/scripts/psyseal-seal.mjs --x402 --lang en`. Failed checks are never charged.
  - Full pass (cleanup + seal, for an agent that fails): the owner runs `node {baseDir}/scripts/psyseal-fix.mjs --apply --x402 --lang en`; it saves the pass request and prints the endpoint. You pay that request; then the owner runs the cleanup again and approves each change.
  - To pay, POST the saved body to the printed endpoint with your x402 client; the price is in the `PAYMENT-REQUIRED` response. Checks during the paid 30 days are free. Passes do not renew automatically.
  - x402 is offered only from some countries. If the service answers 451 (`x402_not_available_in_country`), do not retry: tell the owner to use a card plan at https://psyseal.com/#planes.
  - Paying means the owner accepts Psyseal's Terms (https://psyseal.com/terminos). Show the owner the price, the Terms link and the Privacy notice (https://psyseal.com/privacidad) before paying.
- The report ends with one line linking to psyseal.com, the maker's paid cleanup. The scan is free and complete without it; the scanner only prints that link and never opens it. `--no-cta` removes it.
- Exit codes: 0 no high-severity findings, 1 high-severity findings (`--exit-zero` turns this into 0), 2 usage error.

## What it touches

The scanner reads only the agents' config, instruction, memory and skill files. It does not use the network, write files, start other programs or follow symlinks. The paid `psyseal-fix` and `psyseal-seal` commands are separate and are only run when the owner asks.
