# Thermal Printer Multi-Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect Windows thermal receipt printers across all practical local and network paths, then send ESC/POS jobs independently over every user-enabled transport.

**Architecture:** Windows, network, COM, USB, HID, and Bluetooth observations are normalized into one printer model and conservatively correlated. Main-process adapters handle spooler, TCP, IPP, ePOS, LPR, and COM; a persistent renderer bridge handles Electron's WebUSB, WebHID, and Web Bluetooth APIs and returns per-transport results to a central `Promise.allSettled()` dispatcher.

**Tech Stack:** Electron 39, Node.js CommonJS, Vue 3, PowerShell/CIM/PnP, Electron Device Access APIs, WebUSB, WebHID, Web Bluetooth, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-thermal-printer-multitransport-design.md`

## Global Constraints

- Windows is the supported platform for direct USB, HID, BLE, spooler, and COM discovery.
- ESC/POS is the only printer language added by this plan.
- New transports are disabled until the user explicitly enables them.
- Two enabled transports produce two independent sends; they are not fallbacks.
- One transport failure must not cancel another transport.
- Never replace or reconfigure a Windows device driver automatically.
- Discovery must use no brand or model allowlist by default.
- Preserve existing user changes in `index.js`, `package.json`, `lib/`, and `test/`.
- Do not expose or commit `settings.json`.

## File Structure

- `lib/printers/deviceModel.js`: transport IDs, normalized records, and validation.
- `lib/printers/configMigration.js`: idempotent migration from legacy `protocols`.
- `lib/printers/correlateDevices.js`: conservative grouping of observations.
- `lib/printers/discovery/windows.js`: PowerShell script generation and result normalization.
- `lib/printers/dispatch.js`: multi-transport job and test dispatch.
- `lib/printers/transports/*.js`: main-process spooler, serial, network, IPP, ePOS, and LPR senders.
- `lib/printers/deviceBridgeClient.js`: request/response bridge from main to renderer transports.
- `src/deviceBridge.js`: WebUSB, WebHID, and Web Bluetooth authorization and writes.
- `src/views/PrintersView.vue`: unified printer identity, transport controls, and test results.
- `index.js`: Electron composition, IPC, store integration, and legacy endpoint wiring.
- `test/printers/*.test.cjs`: unit and integration-boundary tests.

## Review Focus

- A device with the same VID/PID but a different serial number must remain separate; Task 2 pins this behavior.
- Two observations with matching names but no stable identity must remain separate; Task 2 pins this behavior.
- A legacy configuration with two enabled routes must preserve both after migration; Task 1 pins this behavior.
- If one of two enabled transports fails, the other must still run and aggregate success must remain true; Task 4 pins this behavior.
- A raw USB/HID/BLE device that is detected but not authorized must remain visible and must return an actionable error rather than disappearing; Tasks 6-9 pin this behavior.

---

### Task 1: Unified Device Model And Legacy Migration

**Files:**
- Create: `lib/printers/deviceModel.js`
- Create: `lib/printers/configMigration.js`
- Create: `test/printers/configMigration.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `TRANSPORT_IDS`, `createTransportState(overrides)`, `createPrinterDevice(input)`, and `migratePrinterConfigurations(printers)`.
- Consumers: Tasks 2-10 use the normalized `transports[transportId] = { available, enabled, verified, config, reason }` shape.

- [ ] **Step 1: Write failing migration tests**

Cover a USB spooler route, a USB serial route, network keys `9100/631/515/80`, two simultaneously enabled legacy routes, missing `protocols`, and idempotent migration of an already-versioned record. Assert `printerConfigVersion === 2` and that no enabled route is lost.

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node --test test/printers/configMigration.test.cjs`

Expected: FAIL because `deviceModel.js` and `configMigration.js` do not exist.

- [ ] **Step 3: Implement the model and migration**

Use these exact transport IDs: `windowsRaw`, `network9100`, `ipp`, `lpr`, `eposHttp`, `usbSerial`, `bluetoothSerial`, `usbRaw`, `usbHid`, and `bluetoothGatt`. Map all legacy Windows spooler keys to `windowsRaw`, preserve connection-specific serial keys, and copy ticket-type settings and hardware identity fields.

- [ ] **Step 4: Make the project test command real**

Change `test` to run discovery, printer, and shared tests. Add `test:printers` as `node --test test/printers/*.test.cjs`; keep the existing scripts.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:printers`

Expected: all migration tests PASS.

Commit: `feat: add printer transport model and migration`

### Task 2: Observation Correlation And Stable Identity

**Files:**
- Create: `lib/printers/correlateDevices.js`
- Create: `test/printers/correlateDevices.test.cjs`

**Interfaces:**
- Consumes: `createPrinterDevice(input)` from Task 1.
- Produces: `correlatePrinterObservations(observations, savedAssociations = []) -> PrinterDevice[]`.

- [ ] **Step 1: Write failing correlation tests**

Assert merges for equal `containerId`, equal `serialNumber + vendorId + productId`, explicit parent/child IDs, exact queue-to-port relationships, and saved associations. Assert no merge for name-only matches or equal VID/PID with different serial numbers. Assert transports from merged observations are all preserved.

- [ ] **Step 2: Run the correlation test and verify RED**

Run: `node --test test/printers/correlateDevices.test.cjs`

Expected: FAIL because `correlatePrinterObservations` is missing.

- [ ] **Step 3: Implement conservative correlation**

Use union-find or an equivalent deterministic grouping algorithm. Generate stable IDs from the strongest available identity and never use `Math.random()` for normalized devices.

- [ ] **Step 4: Run tests and commit**

Run: `npm.cmd run test:printers`

Expected: migration and correlation tests PASS.

Commit: `feat: correlate printer discovery observations`

### Task 3: Broad Windows Discovery Without Default Filters

**Files:**
- Create: `lib/printers/discovery/windows.js`
- Create: `test/printers/windowsDiscovery.test.cjs`
- Modify: `index.js:535-842`
- Modify: `index.js:941-979`
- Modify: `src/views/PrintersView.vue:210-233`
- Modify: `lib/printerDiscovery.js`
- Modify: `test/printerDiscovery.test.cjs`

**Interfaces:**
- Consumes: normalized observations from Task 1 and correlation from Task 2.
- Produces: `buildWindowsDiscoveryScript()`, `normalizeWindowsDiscoveryRows(rows)`, and `discoverWindowsPrinterObservations(runPowerShellJson)`.

- [ ] **Step 1: Write failing discovery normalization tests**

Use fixtures for a Windows queue on `USB008`, a `USBPRINT` PnP child with VID/PID and location, a USB COM port, a Bluetooth COM port, a WSD queue, a HID child, and two unrelated same-name devices. Assert all become observations with identity fields and availability reasons.

- [ ] **Step 2: Run discovery tests and verify RED**

Run: `node --test test/printers/windowsDiscovery.test.cjs`

Expected: FAIL because the Windows discovery module is missing.

- [ ] **Step 3: Implement one Windows snapshot**

Query `Get-Printer`, `Get-PrinterPort`, `Get-PnpDevice -PresentOnly`, selected `Get-PnpDeviceProperty` keys, `Win32_PnPEntity`, and `Win32_SerialPort`. Return JSON rows only; parse and classify them in JavaScript. Keep the current USBPRINT fix and remove duplicate USB PnP mapping from Bluetooth discovery.

- [ ] **Step 4: Wire discovery and change defaults**

Make `discover-printers` default `useFilters` to `false`; initialize `useDiscoveryFilters` to `false` in the Vue cache. Keep the UI filter as an optional narrowing tool. Correlate Windows observations before returning them.

- [ ] **Step 5: Run live read-only diagnostics**

Run the generated PowerShell snapshot on the development machine and verify it returns valid JSON even when any source is empty or unavailable. Do not write settings or drivers.

- [ ] **Step 6: Run tests and commit**

Run: `npm.cmd run test:discovery && npm.cmd run test:printers && node --check index.js`

Expected: all tests PASS and syntax check exits 0.

Commit: `feat: discover all Windows printer transports`

### Task 4: Independent Multi-Transport Dispatcher

**Files:**
- Create: `lib/printers/dispatch.js`
- Create: `test/printers/dispatch.test.cjs`
- Create: `lib/printers/transports/windowsRaw.js`
- Create: `lib/printers/transports/serial.js`
- Create: `lib/printers/transports/network.js`
- Create: `lib/printers/transports/ipp.js`
- Create: `lib/printers/transports/eposHttp.js`
- Create: `test/printers/mainTransports.test.cjs`
- Modify: `index.js:1174-1320`
- Modify: `index.js:1439-1855`

**Interfaces:**
- Consumes: normalized printer records from Task 1.
- Produces: `dispatchEscPosJob(job, printers, senders) -> { success, printerCount, transportCount, results }` and `testPrinterTransports(printer, payload, senders)`.

- [ ] **Step 1: Write failing dispatcher tests**

Assert zero enabled transports returns a clear error; two enabled transports both receive identical base64; a rejected sender does not prevent another sender running; result order is deterministic; aggregate success is true when at least one selected transport succeeds; every selected failure yields aggregate failure.

- [ ] **Step 2: Run dispatcher tests and verify RED**

Run: `node --test test/printers/dispatch.test.cjs`

Expected: FAIL because `dispatchEscPosJob` is missing.

- [ ] **Step 3: Implement dispatch with `Promise.allSettled()` semantics**

Sender signature: `async send({ printer, transport, base64Data })`. Return one result with `printerId`, `transportId`, `success`, and optional `error` for every attempted send.

- [ ] **Step 4: Extract existing senders**

Move current spooler, COM, TCP 9100, IPP, and ePOS logic into focused modules without changing behavior. Serial config must accept `baudRate`, `dataBits`, `parity`, `stopBits`, and a 5000 ms default write timeout.

- [ ] **Step 5: Test the extracted sender boundaries**

With injected PowerShell, socket, IPP, and fetch boundaries, assert that Windows RAW and serial receive the original base64 payload, TCP receives the decoded bytes, IPP uses the decoded bytes with `application/octet-stream`, and ePOS wraps the payload's hexadecimal bytes in `<command>...</command>`. Assert timeout/error propagation and resource cleanup for each adapter.

- [ ] **Step 6: Wire print, reprint, and test IPC**

Replace connection-type branching with the sender registry. Save per-transport results in print history and return them to the renderer and HTTP callers.

- [ ] **Step 7: Run tests and commit**

Run: `npm.cmd run test:printers && npm.cmd run test:shared && node --check index.js`

Expected: all tests PASS.

Commit: `refactor: dispatch ESC POS jobs by transport`

### Task 5: Unified Printer And Transport UI

**Files:**
- Create: `src/printers/transportPresentation.js`
- Create: `test/printers/transportPresentation.test.cjs`
- Modify: `src/views/PrintersView.vue`

**Interfaces:**
- Consumes: normalized `PrinterDevice` records and per-transport test results.
- Produces: transport toggles, advanced config controls, and confirmation state saved through existing IPC.

- [ ] **Step 1: Write failing presentation tests**

Assert labels and editable config fields for all ten transport IDs. Assert unavailable transports are disabled with their `reason`, and multiple available transports can remain enabled together.

- [ ] **Step 2: Run presentation tests and verify RED**

Run: `node --test test/printers/transportPresentation.test.cjs`

Expected: FAIL because the presentation module is missing.

- [ ] **Step 3: Implement presentation helpers and update the Vue view**

Show one card per correlated printer, hardware identity, every detected transport, independent toggles, serial settings, USB/HID endpoint fields, BLE UUID fields, and per-transport test outcomes. Remove connection-type-specific protocol arrays after migration compatibility is covered.

- [ ] **Step 4: Add physical-output confirmation**

After a transport accepts a test write, ask whether a readable ticket printed. Set `verified` only after confirmation; a declined confirmation remains enabled but unverified.

- [ ] **Step 5: Build, inspect, and commit**

Run: `npm.cmd run test:printers && npm.cmd run build:web`

Expected: tests PASS and Vite build exits 0 with no template errors.

Commit: `feat: configure printer transports independently`

### Task 6: Electron Device Permission And Renderer Bridge

**Files:**
- Create: `lib/printers/deviceBridgeClient.js`
- Create: `test/printers/deviceBridgeClient.test.cjs`
- Create: `src/deviceBridge.js`
- Modify: `src/main.js`
- Modify: `index.js:196-225`
- Modify: `index.js:415-422`

**Interfaces:**
- Produces: main-side `createDeviceBridgeClient(webContents, options)` with `request(operation, payload, timeoutMs)` and renderer-side `startDeviceBridge()`.
- Consumers: Tasks 7-9 register `usbRaw`, `usbHid`, and `bluetoothGatt` operations.

- [ ] **Step 1: Write failing bridge client tests**

Use an injected event emitter to assert request IDs, matching responses, 5000 ms timeout behavior, renderer destruction, duplicate/late response handling, and that an unauthorized device result is preserved as an actionable error.

- [ ] **Step 2: Run bridge tests and verify RED**

Run: `node --test test/printers/deviceBridgeClient.test.cjs`

Expected: FAIL because the bridge client is missing.

- [ ] **Step 3: Implement request/response IPC**

Use `printer-device-request` and `printer-device-response` channels. Register the renderer bridge from `src/main.js` so it remains active while the application window is hidden.

- [ ] **Step 4: Configure Electron permissions narrowly**

Handle USB, HID, and Bluetooth selection on `mainWindow.webContents.session`. Permit only the local application origin and only device IDs explicitly selected from the printer UI. Persist grants as hardware identity metadata, not blanket class permissions. Do not disable Chromium blocklists globally.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd run test:printers && npm.cmd run build:web && node --check index.js`

Expected: tests and build PASS.

Commit: `feat: add renderer device transport bridge`

### Task 7: Raw USB Authorization And ESC/POS Sending

**Files:**
- Create: `src/printers/webUsbTransport.js`
- Create: `lib/printers/webUsbConfig.js`
- Create: `test/printers/webUsbConfig.test.cjs`
- Modify: `src/deviceBridge.js`
- Modify: `src/views/PrintersView.vue`
- Modify: `index.js`

**Interfaces:**
- Produces: `authorizeUsbDevice(identity)`, `inspectUsbDevice(device)`, and `sendUsbEscPos(device, config, bytes)` in the renderer; `selectUsbBulkOutEndpoint(interfaces)` as a pure tested helper.

- [ ] **Step 1: Write failing USB configuration tests**

Assert selection of a bulk OUT endpoint, preference for printer-class interfaces, no selection for input-only devices, preservation of explicit user endpoint selection, and an unavailable reason when authorization is missing or Windows owns the interface.

- [ ] **Step 2: Run USB tests and verify RED**

Run: `node --test test/printers/webUsbConfig.test.cjs`

Expected: FAIL because the USB helper is missing.

- [ ] **Step 3: Implement WebUSB authorization and transfer**

Authorization must occur from the user's UI action. For sending: open, select configuration, claim the configured interface, call `transferOut`, then release and close in `finally`. Never reset the device or request a driver change.

- [ ] **Step 4: Register `usbRaw` with dispatcher and UI**

Detected but unauthorized devices remain visible. Test and normal sends use the bridge and return precise DOMException names/messages.

- [ ] **Step 5: Verify and commit**

Run: `npm.cmd run test:printers && npm.cmd run build:web`

Manual: authorize one accessible raw USB device, cancel one authorization, and confirm both states remain visible.

Commit: `feat: support raw USB ESC POS transport`

### Task 8: USB HID Authorization And ESC/POS Sending

**Files:**
- Create: `src/printers/webHidTransport.js`
- Create: `lib/printers/webHidConfig.js`
- Create: `test/printers/webHidConfig.test.cjs`
- Modify: `src/deviceBridge.js`
- Modify: `src/views/PrintersView.vue`
- Modify: `index.js`

**Interfaces:**
- Produces: `authorizeHidDevice(identity)`, `inspectHidDevice(device)`, and `sendHidEscPos(device, config, bytes)`; pure `chunkHidReports(bytes, reportSize, reportId)`.

- [ ] **Step 1: Write failing HID tests**

Assert exact report chunking, padding only when configured, preservation of report ID, rejection of zero/negative report sizes, and visible unauthorized/unavailable states.

- [ ] **Step 2: Run HID tests and verify RED**

Run: `node --test test/printers/webHidConfig.test.cjs`

Expected: FAIL because HID helpers are missing.

- [ ] **Step 3: Implement WebHID authorization and output reports**

Require explicit report ID and report size when descriptors do not identify one unambiguously. Open, send each report sequentially, and close in `finally` when the bridge opened the device.

- [ ] **Step 4: Register `usbHid`, verify, and commit**

Run: `npm.cmd run test:printers && npm.cmd run build:web`

Manual: cancel authorization and verify the printer remains detected with an actionable reason.

Commit: `feat: support HID ESC POS transport`

### Task 9: Bluetooth LE GATT Authorization And ESC/POS Sending

**Files:**
- Create: `src/printers/webBluetoothTransport.js`
- Create: `lib/printers/bluetoothGattConfig.js`
- Create: `test/printers/bluetoothGattConfig.test.cjs`
- Modify: `src/deviceBridge.js`
- Modify: `src/views/PrintersView.vue`
- Modify: `index.js`

**Interfaces:**
- Produces: `authorizeBluetoothDevice(identity)`, `inspectGattServer(server)`, and `sendGattEscPos(device, config, bytes)`; pure `chunkGattWrites(bytes, maxChunkSize)`.

- [ ] **Step 1: Write failing BLE tests**

Assert chunk sizes, ordered writes, invalid UUID rejection, detected-but-unpaired state, missing writable characteristic error, disconnect handling, and retry-free failure reporting.

- [ ] **Step 2: Run BLE tests and verify RED**

Run: `node --test test/printers/bluetoothGattConfig.test.cjs`

Expected: FAIL because BLE helpers are missing.

- [ ] **Step 3: Implement Web Bluetooth selection and GATT writes**

Require a user-selected device and service/characteristic UUID. Prefer `writeValueWithoutResponse` when supported, otherwise use `writeValueWithResponse`. Chunk sequentially and disconnect in `finally` after each job.

- [ ] **Step 4: Register `bluetoothGatt`, verify, and commit**

Run: `npm.cmd run test:printers && npm.cmd run build:web`

Manual: cancel selection, test a missing characteristic, and verify both produce per-transport errors without affecting other enabled sends.

Commit: `feat: support BLE GATT ESC POS transport`

### Task 10: LPR Completion, End-To-End Verification, And Packaging

**Files:**
- Create: `lib/printers/transports/lpr.js`
- Create: `test/printers/lpr.test.cjs`
- Modify: `index.js`
- Modify: `package.json`
- Modify: `docs/release.md`

**Interfaces:**
- Produces: `sendLpr({ host, port = 515, queue = "lp", base64Data, timeoutMs = 5000 })`.
- Completes: all ten transport IDs have a sender or renderer bridge.

- [ ] **Step 1: Write failing LPR protocol tests**

Use an injected socket to assert RFC 1179 receive-job, control-file, and data-file command ordering; zero acknowledgements; non-zero acknowledgement rejection; timeout; and socket cleanup.

- [ ] **Step 2: Run LPR tests and verify RED**

Run: `node --test test/printers/lpr.test.cjs`

Expected: FAIL because `sendLpr` is missing.

- [ ] **Step 3: Implement and register LPR**

Send the original ESC/POS bytes as the data file. Make queue name editable per printer and keep `lp` as the default.

- [ ] **Step 4: Run the complete automated verification**

Run:

```powershell
npm.cmd test
node --check index.js
npm.cmd run build:web
npm.cmd run release:win
```

Expected: all tests pass, syntax check exits 0, Vite build succeeds, and Windows installer/portable artifacts are produced.

- [ ] **Step 5: Run the hardware acceptance matrix**

Verify at least Windows RAW USB, TCP 9100, and USB COM. Where raw USB, HID, or BLE hardware is unavailable, record that the automated adapter tests passed and mark physical verification as outstanding rather than claiming hardware success.

- [ ] **Step 6: Verify migration and multi-send manually**

Start from one existing saved printer, confirm its enabled routes survive migration, enable two transports, print one test, and verify two independent result rows and two physical sends when both targets are available.

- [ ] **Step 7: Commit**

Commit: `feat: complete thermal printer transport support`
