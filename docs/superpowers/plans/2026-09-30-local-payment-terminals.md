# Local Payment Terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mes TPE module that drives local PAX Q25 terminals through Caisse-AP or Nepting over TCP/IP or USB virtual serial ports.

**Architecture:** A `TerminalService` owns configuration, transaction state, idempotency, and per-terminal locks. Protocol adapters produce and parse payment messages independently of injected TCP and serial transports; Electron IPC, authenticated Express routes, and the Vue view all call the same service.

**Tech Stack:** Electron 39, Node.js CommonJS, Vue 3, Express 5, `node:test`, Node `net`, `serialport` 13.

**Spec:** `docs/superpowers/specs/2026-09-30-local-payment-terminals-design.md`

## Global Constraints

- Support protocol IDs `caisse-ap` and `nepting` with transport IDs `tcp` and `serial`.
- Accept only positive integer amounts in cents and currency `EUR` in the first release.
- Never retry or fail over a financial command to another protocol or transport.
- Permit only one active financial command per terminal.
- Require a caller-generated `transactionId`; identical retries return the existing transaction and conflicting reuse is rejected.
- A response timeout after a payment command may have reached the terminal produces `unknown`, never `failed`.
- Never store or log PAN, PIN, track, cryptogram, raw receipt, raw protocol frame, full merchant ID, or SmartEat token.
- Use 5 seconds for connection timeout, 180 seconds for total payment response timeout, and a 250 ms idle window after the last structurally valid response chunk.
- Retain at most 100 terminal transactions and discard entries older than 30 days when loading or appending.
- Do not copy GPL implementation code into this ISC-licensed repository; protocol behavior must be implemented from permitted specifications and fixture values.
- Keep local terminal support in Electron/Windows; do not add it to the Capacitor mobile build.
- Do not automatically claim that all four combinations work on a terminal; verification is per configured protocol/transport pair.

## Review Focus

- A payment response split across multiple TCP/serial data events must be buffered and parsed once, covered in Tasks 2, 3, and 4.
- A timeout after bytes were written must resolve to `unknown` and must not trigger another write, covered in Task 5.
- Reusing a transaction ID with a changed amount or terminal must return `transaction_conflict`, covered in Task 5.
- A malicious HTTP caller must not select an arbitrary host or COM port and must fail authentication, covered in Task 7.
- A terminal removed or disabled while a payment is active must retain the active transaction and reject configuration mutation until completion, covered in Tasks 1 and 5.

---

## File Map

- `lib/terminals/model.js`: constants, configuration/payment validation, persistence-safe normalization, redaction.
- `lib/terminals/tlv.js`: strict two-character tag/three-digit length encoder and streaming decoder.
- `lib/terminals/protocols/caisseAp.js`: Caisse-AP V3 exchanges and normalized response mapping.
- `lib/terminals/protocols/nepting.js`: Nepting local exchanges, identifiers, and normalized response mapping.
- `lib/terminals/transports/tcp.js`: socket lifecycle and buffered request/response exchanges.
- `lib/terminals/transports/serial.js`: COM enumeration and serial exchange lifecycle.
- `lib/terminals/transactions.js`: state machine, bounded transaction registry, and idempotency checks.
- `lib/terminals/service.js`: adapter selection, locks, orchestration, timeouts, persistence.
- `lib/terminals/ipc.js`: Electron IPC registration.
- `lib/terminals/http.js`: authenticated Express route registration.
- `src/terminals/presentation.mjs`: UI labels, defaults, and conditional-field helpers.
- `src/views/TerminalsView.vue`: Mes TPE management and payment test UI.
- `src/App.vue`: navigation and view mount.
- `index.js`: dependency composition only.
- `settings.example.json`: non-secret terminal configuration example.
- `test/terminals/*.test.cjs`: main-process unit and integration tests.
- `test/terminals/presentation.test.cjs`: frontend pure-helper tests.
- `docs/terminals/pax-q25-acceptance.md`: repeatable hardware acceptance checklist.

### Task 1: Terminal Model and Validation

**Files:**
- Create: `lib/terminals/model.js`
- Create: `test/terminals/model.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `PROTOCOL_IDS`, `TRANSPORT_IDS`, `normalizeTerminalConfig(input)`, `validateTerminalConfig(input)`, `validatePaymentRequest(input)`, `redactTerminalValue(value)`.
- Produces normalized configuration fields exactly as defined in the spec: `id`, `name`, `manufacturer`, `model`, `enabled`, `protocol`, `protocolVersion`, `transport`, `tcp`, `serial`, and `nepting`.

- [ ] **Step 1: Add the terminal test script and failing model tests**

Add `test:terminals` as `node --test test/terminals/*.test.cjs` and include it in `test`. Test all four protocol/transport combinations, unknown-field removal, invalid IP port/COM settings, `amount: 1590`, EUR-only validation, redaction, and rejection of mutation fields not in the model.

- [ ] **Step 2: Run model tests and verify they fail**

Run: `npm.cmd run test:terminals`

Expected: FAIL because `lib/terminals/model.js` does not exist.

- [ ] **Step 3: Implement the model API**

Use allow-list reconstruction rather than object spreading. Return validation results as `{ ok: true, value }` or `{ ok: false, code: "invalid_configuration", errors: string[] }`; payment validation uses `invalid_payment_request` for malformed requests.

- [ ] **Step 4: Run model tests**

Run: `npm.cmd run test:terminals`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json lib/terminals/model.js test/terminals/model.test.cjs
git commit -m "feat: add payment terminal configuration model"
```

### Task 2: TLV Codec and Protocol Adapters

**Files:**
- Create: `lib/terminals/tlv.js`
- Create: `lib/terminals/protocols/caisseAp.js`
- Create: `lib/terminals/protocols/nepting.js`
- Create: `test/terminals/tlv.test.cjs`
- Create: `test/terminals/protocols.test.cjs`

**Interfaces:**
- Consumes: normalized terminal and payment objects from Task 1.
- Produces: `encodeTlv(entries) -> Buffer`, `createTlvDecoder() -> { push(chunk), finish() }`.
- Produces: `createCaisseApProtocol()` and `createNeptingProtocol()`, each exposing `id`, `capabilities(config)`, `createProbe(config)`, `createPayment(request, config)`, `createCancellation(transaction, config)`, and `parseResponse(buffer, exchange)`.
- Produces normalized protocol results `{ state, message, authorizationReference?, merchantReference?, rawCode? }`; no raw frame or receipt leaves the adapter.

- [ ] **Step 1: Write failing strict TLV tests**

Test `CZ0040320`, duplicate tags, a zero length, nonnumeric lengths, unknown tags, chunks split inside tag/length/value, incomplete `finish()`, and a maximum 999-byte value. Unknown response tags must be accepted and ignored by adapters after structural validation.

- [ ] **Step 2: Run TLV tests and verify they fail**

Run: `node --test test/terminals/tlv.test.cjs`

Expected: FAIL because the codec does not exist.

- [ ] **Step 3: Implement the streaming TLV codec**

Keep ASCII framing strict. The decoder returns complete `{ tag, value }` entries only after the declared value length is available and retains incomplete bytes between `push` calls.

- [ ] **Step 4: Run TLV tests**

Run: `node --test test/terminals/tlv.test.cjs`

Expected: PASS.

- [ ] **Step 5: Write failing protocol fixture tests**

For a EUR 15.90 debit, assert required fields include `CZ`, a 12-character `CJ`, `CA00201`, `CB0041590`, `CD0010`, and `CE003978`, with `CZ` first. For Nepting, assert `CF` carries `transactionId`; test `AE00210` as approved, `AE00201` with refusal code as declined, customer abandonment as cancelled, malformed frames as `protocol_mismatch`, and receipt tag `AK` omission from returned data. Assert unsupported cancellation reports `cancellation_not_supported` rather than closing a transport.

- [ ] **Step 6: Implement both protocol adapters**

Caisse-AP defaults to protocol version `0300`; Nepting defaults to `0320`. Keep adapter-specific required identifiers and capabilities separate even where tags overlap. Cancellation capability is true only for a configured/documented adapter variant with a tested command fixture.

- [ ] **Step 7: Run protocol tests**

Run: `node --test test/terminals/tlv.test.cjs test/terminals/protocols.test.cjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add lib/terminals/tlv.js lib/terminals/protocols test/terminals/tlv.test.cjs test/terminals/protocols.test.cjs
git commit -m "feat: add Caisse-AP and Nepting protocol adapters"
```

### Task 3: TCP Transport

**Files:**
- Create: `lib/terminals/transports/tcp.js`
- Create: `test/terminals/tcp.test.cjs`

**Interfaces:**
- Consumes: `{ request: Buffer, isStructurallyValid(buffer): boolean, connectTimeoutMs, responseTimeoutMs, responseIdleMs }` from a protocol exchange.
- Produces: `createTcpTransport({ createSocket })` with `probe(config, exchange)` and `exchange(config, exchange) -> Promise<{ response: Buffer, requestWritten: boolean }>`.

- [ ] **Step 1: Write failing fake-socket tests**

Test connection refusal before write, split response chunks, completion after the 250 ms valid-frame idle window without waiting for socket close, connect timeout, response timeout after write, one write only, and unconditional socket destruction after resolution or rejection.

- [ ] **Step 2: Run TCP tests and verify they fail**

Run: `node --test test/terminals/tcp.test.cjs`

Expected: FAIL because the transport does not exist.

- [ ] **Step 3: Implement the TCP transport with Node `net`**

Inject `net.Socket` creation for tests. Attach listeners before connecting, buffer bytes, and include `requestWritten` on transport errors so Task 5 can distinguish `failed` from `unknown`.

- [ ] **Step 4: Run TCP tests**

Run: `node --test test/terminals/tcp.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/terminals/transports/tcp.js test/terminals/tcp.test.cjs
git commit -m "feat: add payment terminal TCP transport"
```

### Task 4: USB Serial Transport

**Files:**
- Create: `lib/terminals/transports/serial.js`
- Create: `test/terminals/serial.test.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: the same protocol exchange shape as Task 3 and normalized `serial` configuration from Task 1.
- Produces: `createSerialTransport({ SerialPortClass, listPorts })` with `list()`, `probe(config, exchange)`, and `exchange(config, exchange) -> Promise<{ response: Buffer, requestWritten: boolean }>`.

- [ ] **Step 1: Write failing fake-port tests**

Test COM enumeration normalization, 115200/8/N/1 settings, split reads, open failure before write, timeout after write, one write only, and close/dispose behavior. Include a test where a configured port disappears between listing and opening and expect `serial_port_not_found`.

- [ ] **Step 2: Run serial tests and verify they fail**

Run: `node --test test/terminals/serial.test.cjs`

Expected: FAIL because the transport does not exist.

- [ ] **Step 3: Install the production serial dependency**

Run: `npm.cmd install serialport@13.0.0`

Expected: `serialport` appears under `dependencies` and the lockfile updates.

- [ ] **Step 4: Implement the serial transport**

Normalize `COM8:` to `COM8`, pass all configured line settings to `SerialPort`, and expose only non-sensitive port metadata `{ path, manufacturer, serialNumber, vendorId, productId }`.

- [ ] **Step 5: Run serial tests**

Run: `node --test test/terminals/serial.test.cjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json lib/terminals/transports/serial.js test/terminals/serial.test.cjs
git commit -m "feat: add payment terminal serial transport"
```

### Task 5: Transaction Registry and Terminal Service

**Files:**
- Create: `lib/terminals/transactions.js`
- Create: `lib/terminals/service.js`
- Create: `test/terminals/transactions.test.cjs`
- Create: `test/terminals/service.test.cjs`

**Interfaces:**
- Consumes: Task 1 validators, Task 2 protocol map `{ "caisse-ap": adapter, nepting: adapter }`, transport map `{ tcp, serial }`, and a store with `get`, `set`.
- Produces: `createTransactionRegistry({ initial, now, maxEntries, maxAgeMs })`.
- Produces: `createTerminalService({ store, protocols, transports, now })` with the eight public methods defined in the spec.

- [ ] **Step 1: Write failing transaction state and retention tests**

Test permitted state transitions, terminal-state immutability, newest-first persistence, age/count eviction, and sanitization of restored entries.

- [ ] **Step 2: Run registry tests and verify they fail**

Run: `node --test test/terminals/transactions.test.cjs`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the transaction registry**

Use exactly the normalized states from the spec. Persist only IDs, terminal, amount, currency, state, timestamps, sanitized message, and non-sensitive references.

- [ ] **Step 4: Write failing service tests**

Test save/list/delete, refusal to mutate an active terminal, adapter selection for all four combinations, protocol-level probes, one lock per terminal, identical idempotent replay, conflicting replay as `transaction_conflict`, timeout-before-write as `failed`, timeout-after-write as `unknown`, no fallback write, and cancellation capability handling.

- [ ] **Step 5: Implement `TerminalService`**

`startPayment` persists `queued` and starts processing asynchronously, returning the current public transaction immediately. Map internal errors to stable codes and never expose adapter/transport stacks.

- [ ] **Step 6: Run service tests**

Run: `node --test test/terminals/transactions.test.cjs test/terminals/service.test.cjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add lib/terminals/transactions.js lib/terminals/service.js test/terminals/transactions.test.cjs test/terminals/service.test.cjs
git commit -m "feat: orchestrate local terminal payments"
```

### Task 6: Electron IPC and Main-Process Composition

**Files:**
- Create: `lib/terminals/ipc.js`
- Create: `test/terminals/ipc.test.cjs`
- Modify: `index.js`

**Interfaces:**
- Consumes: `TerminalService` from Task 5 and Electron `ipcMain`.
- Produces: `registerTerminalIpc({ ipc, service }) -> dispose()` with the eight IPC channel names from the spec.

- [ ] **Step 1: Write failing IPC registration tests**

Use a fake `ipcMain` and assert each channel delegates only to its matching service method, preserves stable errors, and that `dispose()` removes every handler.

- [ ] **Step 2: Run IPC tests and verify they fail**

Run: `node --test test/terminals/ipc.test.cjs`

Expected: FAIL because IPC registration does not exist.

- [ ] **Step 3: Implement IPC registration and compose dependencies in `index.js`**

Instantiate the two protocols, two transports, and one service after `electron-store` is available. Keep all handler bodies out of `index.js`.

- [ ] **Step 4: Run IPC and syntax checks**

Run: `node --test test/terminals/ipc.test.cjs`

Run: `node --check index.js`

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.js lib/terminals/ipc.js test/terminals/ipc.test.cjs
git commit -m "feat: expose terminal management over Electron IPC"
```

### Task 7: Authenticated Local Payment HTTP API

**Files:**
- Create: `lib/terminals/http.js`
- Create: `test/terminals/http.test.cjs`
- Modify: `index.js`

**Interfaces:**
- Consumes: `registerTerminalRoutes({ app, service, getSessionToken })` inputs and Task 5 service methods.
- Produces: the five HTTP routes and status mapping from the spec.

- [ ] **Step 1: Write failing route tests with an isolated Express app**

Using an ephemeral HTTP listener and Node's built-in `fetch`, test missing/wrong bearer tokens as `401`, disabled/missing terminals as `404`, invalid payload as `400`, accepted payment as `202`, idempotent replay as `200` or `202` matching current state, conflict as `409`, busy as `409`, status polling, cancellation, and rejection of caller-supplied `host`, `port`, or `serial` fields.

- [ ] **Step 2: Run HTTP tests and verify they fail**

Run: `node --test test/terminals/http.test.cjs`

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement routes and bearer authentication**

Read the terminal configuration only through the service. Compare the bearer token with `store.get("userSession.token")`; never log either value. Register routes next to existing Express setup through one call from `index.js`.

- [ ] **Step 4: Run HTTP tests and syntax checks**

Run: `node --test test/terminals/http.test.cjs`

Run: `node --check index.js`

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add index.js lib/terminals/http.js test/terminals/http.test.cjs
git commit -m "feat: add authenticated local payment API"
```

### Task 8: Mes TPE Vue Interface

**Files:**
- Create: `src/terminals/presentation.mjs`
- Create: `src/views/TerminalsView.vue`
- Create: `test/terminals/presentation.test.cjs`
- Modify: `src/App.vue`

**Interfaces:**
- Consumes: IPC channels from Task 6.
- Produces: `newTerminalDraft()`, `visibleTerminalFields(config)`, `terminalStatusPresentation(state)`, and the Mes TPE view.

- [ ] **Step 1: Write failing presentation-helper tests**

Assert the default PAX Q25 draft, exactly one transport field group, Nepting identifier visibility only for Nepting, French labels for every normalized state, and no success label for an unverified open port.

- [ ] **Step 2: Run presentation tests and verify they fail**

Run: `node --test test/terminals/presentation.test.cjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement presentation helpers**

Keep UI-only labels and defaults out of the main process.

- [ ] **Step 4: Implement `TerminalsView.vue` and navigation**

Build the terminal list, focused add/edit form, protocol and transport selectors, conditional TCP/serial/Nepting fields, COM refresh, connection test, delete confirmation, and payment-test dialog. Disable configuration actions during an active transaction and expose cancellation only when the service reports it as available.

- [ ] **Step 5: Run helper tests and production build**

Run: `node --test test/terminals/presentation.test.cjs`

Run: `npm.cmd run build:web`

Expected: tests PASS and Vite build completes without warnings caused by the new module.

- [ ] **Step 6: Commit**

```powershell
git add src/App.vue src/terminals/presentation.mjs src/views/TerminalsView.vue test/terminals/presentation.test.cjs
git commit -m "feat: add Mes TPE management interface"
```

### Task 9: Example Configuration, Acceptance Guide, and Full Verification

**Files:**
- Modify: `settings.example.json`
- Create: `docs/terminals/pax-q25-acceptance.md`
- Modify: `test/terminals/service.test.cjs`

**Interfaces:**
- Consumes: completed module from Tasks 1-8.
- Produces: a credential-free example and a repeatable record for verifying each Q25 protocol/transport pair.

- [ ] **Step 1: Add a credential-free disabled Q25 example**

Include one disabled terminal with placeholder IP/COM values and empty Nepting identifiers. Do not modify or read the user's runtime `settings.json`.

- [ ] **Step 2: Add the hardware acceptance checklist**

For each enabled pair, record terminal application/version, protocol setting, transport setting, driver/COM or IP/port, connectivity probe, approved low-value payment, decline, customer cancellation, timeout/unknown reconciliation, restart recovery, and terminal-journal reconciliation.

- [ ] **Step 3: Add a no-sensitive-data regression test**

Feed PAN-like digits, a token, merchant ID, raw frame, and receipt into fake adapter errors/results; assert none appear in persisted transactions, service results, or serialized logs returned by the tested redactor.

- [ ] **Step 4: Run complete automated verification**

Run: `npm.cmd run verify`

Expected: all discovery, printer, terminal, and shared tests pass; `node --check index.js` passes; Vite production build succeeds.

- [ ] **Step 5: Run Electron smoke test**

Run: `npx.cmd electron .`

Expected: the app opens, Mes TPE loads, terminal configuration can be saved, and no main/renderer error appears. Close the app after the check.

- [ ] **Step 6: Perform available PAX Q25 hardware acceptance**

Execute only combinations enabled on the test terminal. Record unsupported combinations explicitly; do not simulate success or change terminal provisioning without the maintainer.

- [ ] **Step 7: Commit**

```powershell
git add settings.example.json docs/terminals/pax-q25-acceptance.md test/terminals/service.test.cjs
git commit -m "docs: add PAX Q25 terminal acceptance workflow"
```

### Task 10: Final Review and Release Readiness

**Files:**
- Review: all files changed by Tasks 1-9

**Interfaces:**
- Consumes: complete implementation and verification evidence.
- Produces: reviewed branch ready for integration; no new production interface.

- [ ] **Step 1: Review the diff against the approved spec**

Run: `git diff c6b01e1..HEAD --stat`

Run: `git diff c6b01e1..HEAD --check`

Expected: only terminal-module, integration, dependency, test, example, and acceptance files changed; no whitespace errors.

- [ ] **Step 2: Re-run the full verification command**

Run: `npm.cmd run verify`

Expected: PASS with no skipped terminal tests.

- [ ] **Step 3: Verify the Windows package includes the native serial dependency**

Run: `npm.cmd run release:win`

Expected: Electron Builder completes for Windows and does not report a missing `serialport` native binary.

- [ ] **Step 4: Review secrets and generated artifacts**

Run: `git status --short`

Run: `git diff c6b01e1..HEAD -- settings.json dist6 frontend/dist`

Expected: no runtime settings, credentials, built installers, or generated frontend output are staged.

- [ ] **Step 5: Request final code review**

Review specifically for duplicate-payment risk, timeout-to-unknown mapping, protocol framing, authentication, redaction, and native serial packaging.
