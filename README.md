# Psyseal

Revisión local de tus agentes de IA, limpieza con respaldo y sello firmado · Local review of your AI agents, cleanup with a backup and a signed seal.

Funciona con OpenClaw, Hermes Agent, nanobot, PicoClaw, ZeroClaw, NanoClaw y cualquier carpeta de agente.
Works with OpenClaw, Hermes Agent, nanobot, PicoClaw, ZeroClaw, NanoClaw and any agent folder.

---

## Español

Requiere Node 20 o más reciente. Corre el programa en la computadora o servidor donde vive tu agente.

### 1. Escáner (gratis, solo lectura)

```bash
node scripts/psyseal-scan.mjs                     # busca por sí mismo los agentes que haya en esta computadora
node scripts/psyseal-scan.mjs --path ./mi-agente  # revisa una carpeta en particular
node scripts/psyseal-scan.mjs --platform hermes   # solo una plataforma
```

Revisa:

1. **Lo que tu agente carga en cada mensaje**: tamaño de sus archivos de instrucciones y memoria, y cuáles se recortan sin avisar.
2. **Tareas programadas y latidos**: cuántas veces corren al día y cuánto cuestan al mes, en tokens y en dólares cuando conoce el precio del modelo.
3. **Credenciales en texto plano** en la memoria, las instrucciones y las skills, y archivos de credenciales que otros usuarios pueden leer. Se reporta tipo, archivo y línea; nunca el valor.
4. **Memoria envenenada o inflada**: texto que parece una orden plantada, caracteres invisibles, líneas repetidas y bloques gigantes.

Cada hallazgo trae el arreglo concreto. Opciones: `--help`. Códigos de salida: 0 sin hallazgos altos · 1 hay hallazgos altos · 2 error de uso.

También funciona como servidor MCP, con una sola herramienta de solo lectura (`scan_agents`): `node scripts/psyseal-scan.mjs mcp`. El escáner gratis también está en npm: `npx psyseal-scan` y, como servidor MCP, `npx -y psyseal-scan mcp`.

**Qué no hace:** no usa la red, no escribe archivos, no ejecuta otros programas, no sigue enlaces simbólicos y no imprime tu memoria ni tus claves. Los costos son estimaciones, no promesas. Los detectores marcan para revisar y pueden dejar pasar casos.

### 2. Limpieza (de pago, con respaldo)

```bash
node scripts/psyseal-fix.mjs            # vista previa gratis: muestra cada cambio, no toca nada
node scripts/psyseal-fix.mjs --apply    # aplica solo los cambios que apruebes, uno por uno
node scripts/psyseal-fix.mjs --undo <id>
```

**Tu clave de licencia** empieza con `PSYSEAL-`. Está en el correo de Polar «You're now subscribed to Psyseal…» (botón «Access purchase» → «Psyseal · 1 agente» o «10 agentes» → «Copy») y en tu portal, https://polar.sh/psyseal/portal, entrando con el correo de tu compra. La primera vez agrégala con `--key <tu clave>`; queda guardada en `~/.psyseal/license.json`. Guía paso a paso: https://psyseal.com/guia

Antes de tocar un archivo guarda una copia en `~/.psyseal/backups/`. Quita las claves expuestas (deja una marca [REDACTED] en su lugar), quita líneas sospechosas (quedan en el respaldo para que las revises), quita repetidos, mueve bloques gigantes a un archivo aparte, cierra permisos y ajusta la frecuencia de los latidos. Al final vuelve a escanear y te dice cuánto quedó. Deshacer no pisa cambios que hayas hecho después.

Con un plan, su única conexión a internet es para validar tu licencia con Polar, la plataforma que cobra: envía la clave, un código seudónimo de cada agente (se calcula en tu computadora y no revela su ruta ni su contenido) y su plataforma con su nombre corto, para que veas en tu portal qué agentes usan tu plan. Con `--x402`, en cambio, consulta tu pase en el servicio del sello (envía el mismo código seudónimo y la plataforma). Nunca envía contenido de tus agentes.

### 3. Sello (incluido en el plan)

```bash
node scripts/psyseal-seal.mjs --dry-run   # muestra exactamente qué se enviaría, sin enviar nada
node scripts/psyseal-seal.mjs             # pide el sello de tus agentes
```

Sin plan, el propio agente puede pagar con USDC (x402), si su dueño lo autoriza: el pase de sello si ya pasa (`node scripts/psyseal-seal.mjs --x402`), o el pase completo con limpieza si no pasa (`node scripts/psyseal-fix.mjs --apply --x402`). El programa prepara el pedido y el agente lo paga con su cartera. Los pases x402 solo se ofrecen desde algunos países; desde los demás se usa un plan con tarjeta. Al pagar aceptas los [Términos](https://psyseal.com/terminos); el [Aviso de privacidad](https://psyseal.com/privacidad) explica qué datos del pago se tratan.

Revisa cada agente en tu computadora y, si ninguna de las 3 revisiones obligatorias sale «no pasó» (claves expuestas; instrucciones inyectadas de riesgo alto en su memoria o sus instrucciones, es decir, que pidan enviar credenciales, ocultarle algo al dueño o descargar y ejecutar código; y permisos de credenciales), recibe un sello firmado con una página pública (`https://seal.psyseal.com/<código>`) y una insignia para tu perfil o README: el programa te da la línea lista para pegar en el `README.md` de tu agente. Para ver que sigue vigente, abre su página: arriba dice si está vigente y hasta cuándo, y la insignia cambia sola si se suspende o vence. «Mejorable» y «no aplica» no impiden el sello, y la página lo muestra tal cual; una orden sospechosa dentro de una skill sale como «mejorable», porque muchas traen instrucciones legítimas de instalación o de uso de APIs. Al servicio del sello solo llegan los resultados y una huella de los archivos, nunca su contenido; Psyseal firma esos resultados, pero no los verifica por su cuenta. El sello se renueva cada vez que lo pides y las revisiones pasan, y vence a los 30 días de la última revisión que pasó o al terminar el periodo que pagaste, lo que ocurra primero. Si una revisión obligatoria no pasa, el sello se suspende hasta que vuelva a pasar. El sello no es una certificación oficial ni una auditoría: muestra el resultado que reportó el programa y hasta cuándo es vigente. Ver los [Términos](https://psyseal.com/terminos), punto 7.

Licencias: ver `LICENSE.md`.

---

## English

Needs Node 20 or newer. Run it on the computer or server where your agent lives.

### 1. Scanner (free, read-only)

```bash
node scripts/psyseal-scan.mjs --lang en
node scripts/psyseal-scan.mjs --path ./my-agent --lang en
node scripts/psyseal-scan.mjs --platform hermes --lang en
```

It checks what your agent loads on every message, how often its scheduled tasks and heartbeats run and what they cost, plaintext credentials (type, file and line only, never the value), and poisoned or bloated memory. Every finding comes with a concrete fix.

It also works as an MCP server with one read-only tool (`scan_agents`): `node scripts/psyseal-scan.mjs mcp`. The free scanner is also on npm: `npx psyseal-scan`, and as an MCP server, `npx -y psyseal-scan mcp`.

**What it does not do:** no network, no file writes, no child processes, no symlink following, and it never prints your memory or your keys. Costs are estimates, not promises.

### 2. Cleanup (paid, with a backup)

```bash
node scripts/psyseal-fix.mjs --lang en          # free preview: shows every change, touches nothing
node scripts/psyseal-fix.mjs --apply --lang en  # applies only the changes you approve, one by one
node scripts/psyseal-fix.mjs --undo <id>
```

**Your license key** starts with `PSYSEAL-`. It is in the Polar email "You're now subscribed to Psyseal…" ("Access purchase" button → "Psyseal · 1 agente" or "10 agentes" → "Copy") and in your portal, https://polar.sh/psyseal/portal, signing in with the email you bought with. The first time, add it with `--key <your key>`; it is saved in `~/.psyseal/license.json`. Step-by-step guide: https://psyseal.com/guia

It copies every file to `~/.psyseal/backups/` before touching it, re-scans at the end, and undo never overwrites changes you made afterwards. With a plan, its only network call validates your license with Polar (the key, a pseudonymous code for each agent, computed on your computer and revealing neither its path nor its content, and its platform and short name; never agent content). With `--x402` it checks your pass with the seal service instead (the same pseudonymous code and the platform).

### 3. Seal (included in the plan)

```bash
node scripts/psyseal-seal.mjs --dry-run --lang en   # shows exactly what would be sent, sends nothing
node scripts/psyseal-seal.mjs --lang en             # requests the seal for your agents
```

Without a plan, the agent itself can pay in USDC (x402), if its owner authorizes it: the seal pass if it already passes (`node scripts/psyseal-seal.mjs --x402 --lang en`), or the full pass with cleanup if it fails (`node scripts/psyseal-fix.mjs --apply --x402 --lang en`). The program prepares the request and the agent pays with its wallet. x402 passes are offered only from some countries; elsewhere, use a card plan. By paying you accept the [Terms](https://psyseal.com/terminos); the [Privacy notice](https://psyseal.com/privacidad) explains which payment data is processed.

It checks each agent on your computer and, if none of the 3 required checks comes out "failed" (exposed keys; high-risk injected instructions in its memory or instructions, meaning ones that ask to send credentials out, hide something from the owner, or download and run code; and credential permissions), the agent gets a signed seal with a public page and a badge: the program gives you the line, ready to paste into your agent's `README.md`. To see that it is still valid, open its page: the top says whether it is valid and until when, and the badge changes by itself if it is suspended or expires. "Could improve" and "not applicable" do not prevent the seal, and the page shows them as they are; a suspicious order inside a skill comes out as "could improve", because many skills carry legitimate install or API instructions. Only the results and a fingerprint of the files reach the seal service, never their content; Psyseal signs those results but does not verify them on its own. The seal renews every time you request it and the checks pass, and expires 30 days after the last check that passed or at the end of the period you paid for, whichever comes first. If a required check fails, the seal is suspended until it passes again. The seal is not an official certification or an audit: it shows the result the program reported and until when it is valid. See the [Terms](https://psyseal.com/terminos), section 7.

Licenses: see `LICENSE.md`.
