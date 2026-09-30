# Local Payment Terminals Design

**Date:** 2026-09-30
**Status:** Ready for review

## Purpose

Add a **Mes TPE** module to SmartEat Printer Agent for configuring and driving local payment terminals. The first physical target is a PAX Q25 used in France.

The module supports two protocols and two transports:

| Protocol | TCP/IP | USB virtual serial port |
| --- | --- | --- |
| Caisse-AP / Concert V3 | Supported | Supported |
| Nepting local protocol | Supported | Supported |

Support in the application does not guarantee that every terminal firmware exposes every combination. The terminal's payment application and maintainer configuration determine the combinations available on a specific device.

## Goals

- Add a **Mes TPE** navigation entry and management view.
- Save multiple local terminal configurations without storing card data.
- Detect Windows serial ports and configure a USB-connected Q25.
- Configure a terminal by protocol and transport independently.
- Test connectivity without starting a financial transaction.
- Start one EUR payment at a time on a selected terminal.
- Report normalized payment states to both the Electron UI and the local HTTP API.
- Request cancellation while a payment is still cancellable.
- Prevent accidental duplicate payments after timeouts or lost responses.
- Keep protocol codecs independent from TCP and serial I/O.

## Non-goals

- Stripe Terminal or any other cloud payment provider.
- Reading, transmitting, logging, or storing PAN, PIN, track, or cryptogram data.
- Terminal provisioning, banking contract activation, or remote firmware configuration.
- Automatic protocol or transport failover during a payment.
- Refunds, reversals after completion, pre-authorizations, tips, and receipt retrieval in the first release.
- Automatic discovery of payment terminals across arbitrary networks.
- Mobile/Capacitor support for local terminals in the first release.

## Design Principles

### Protocol and transport are separate

The payment command is converted into a protocol message by a protocol adapter. A transport adapter then carries the resulting bytes over TCP or a Windows serial port. This avoids four independent implementations and allows future terminal types to reuse either layer.

### No payment failover

A connection timeout does not prove that a payment failed. The customer may have completed the transaction while the response was lost. Once a payment starts, the agent remains bound to the selected protocol and transport until the transaction reaches a terminal state or becomes `unknown`. It never retries the financial command on another path automatically.

### One active command per terminal

Each terminal has a mutex. A second payment request receives a `terminal_busy` response while a payment or cancellation is in progress. Connectivity probes are also rejected while a financial command is active.

### Idempotent callers

Every payment requires a caller-generated `transactionId`. The agent records recent transaction IDs and returns the known state when the same request is repeated. Reusing an ID with a different terminal, amount, or currency is rejected.

## Architecture

New main-process code will live under `lib/terminals/` rather than adding protocol logic to `index.js`.

```text
Vue Mes TPE view / SmartEat local HTTP client
                    |
           terminal IPC and HTTP handlers
                    |
             TerminalService
          /          |           \
 configuration   transaction    per-terminal
    store          registry         locks
                    |
              protocol adapter
          /                         \
 CaisseApProtocol              NeptingProtocol
          \                         /
               transport adapter
          /                         \
   TcpTransport                SerialTransport
```

### TerminalService

`TerminalService` is the only entry point used by IPC and HTTP handlers. It validates configuration and payment requests, selects adapters, owns transaction state, applies timeouts, normalizes results, and prevents concurrent commands.

Public operations:

- `listTerminals()`
- `saveTerminal(config)`
- `deleteTerminal(id)`
- `listSerialPorts()`
- `testConnection(id)`
- `startPayment(request)`
- `getPayment(transactionId)`
- `cancelPayment(transactionId)`

### Protocol adapters

Both adapters implement the same interface:

```js
createProbe(context) -> ProtocolExchange
createPayment(request, context) -> ProtocolExchange
createCancellation(transaction, context) -> ProtocolExchange
parseResponse(buffer, exchange) -> ProtocolEvent[]
```

`ProtocolExchange` describes the bytes to send, framing expectations, timeout policy, and whether an acknowledgement is required. `ProtocolEvent` reports progress or a terminal result without exposing transport-specific errors to callers.

`CaisseApProtocol` implements the selected Concert V3 dialect. Serial control characters and acknowledgements remain part of the protocol exchange, while opening and reading the COM port remains the serial transport's responsibility.

`NeptingProtocol` implements the local TLV request/response flow supported by the configured payment application. It accepts the merchant and cash-register identifiers required by the terminal configuration. Nepting variants must be represented by an explicit adapter version instead of guessing from responses during a payment.

Protocol implementations must be based on documentation the project is legally permitted to use. GPL implementation code must not be copied into this ISC-licensed repository.

### Transport adapters

`TcpTransport` uses Node's `net` module. It accepts a host, port, connect timeout, and response timeout. It opens a fresh connection for an exchange unless the selected protocol version explicitly requires a persistent session.

`SerialTransport` uses the `serialport` package. It accepts a COM path, baud rate, data bits, parity, stop bits, flow control, and response timeout. Defaults for a Q25 Nepting setup are `115200`, 8 data bits, no parity, and 1 stop bit, but all serial settings are stored because Caisse-AP installations may differ.

Both transports expose `open`, `write`, `close`, and data/error events. They do not interpret payment messages.

## Configuration Model

Configurations are stored in the existing `electron-store` document under `terminals`.

```json
{
  "id": "tpe-counter-1",
  "name": "TPE comptoir",
  "manufacturer": "PAX",
  "model": "Q25",
  "enabled": true,
  "protocol": "nepting",
  "protocolVersion": "3.20",
  "transport": "serial",
  "tcp": {
    "host": "192.168.1.50",
    "port": 8888
  },
  "serial": {
    "path": "COM8",
    "baudRate": 115200,
    "dataBits": 8,
    "parity": "none",
    "stopBits": 1,
    "flowControl": "none"
  },
  "nepting": {
    "merchantId": "",
    "cashRegisterId": ""
  }
}
```

Only the settings for the selected protocol and transport are required. Unknown fields are removed during validation. Merchant identifiers are treated as private configuration and are never returned by diagnostic logs in full.

Recent transaction metadata is stored separately under `terminalTransactions`. It contains the transaction ID, terminal ID, amount, currency, timestamps, normalized state, and non-sensitive authorization/reference values returned for reconciliation. Retention is bounded by count and age.

## User Interface

`src/App.vue` gains a **Mes TPE** navigation item and renders `src/views/TerminalsView.vue`.

The view contains:

- A compact list of configured terminals with enabled, protocol, transport, and last-known connection status.
- Add, edit, delete, enable/disable, and test-connection actions.
- Protocol selector: `Caisse-AP / Concert V3` or `Nepting`.
- Transport selector: `TCP/IP` or `USB / port COM`.
- Conditional TCP, serial, and Nepting fields.
- A serial-port refresh action using the ports reported by the Electron main process.
- A payment test dialog requiring an explicit amount and confirmation.
- A live payment state with a cancellation action only while cancellation is allowed.

The interface does not claim a combination is supported merely because a port opens. A successful protocol-level probe is required for a positive status.

## IPC Contract

Renderer-to-main calls use `ipcRenderer.invoke` and return serializable result objects:

- `terminals:list`
- `terminals:save`
- `terminals:delete`
- `terminals:list-serial-ports`
- `terminals:test-connection`
- `terminal-payments:start`
- `terminal-payments:get`
- `terminal-payments:cancel`

All handlers validate payloads in the main process. Errors use stable codes rather than exposing raw stack traces.

## Local HTTP API

The existing Express agent exposes equivalent operations for the SmartEat checkout:

- `GET /terminals`
- `POST /terminals/:id/test`
- `POST /terminal-payments`
- `GET /terminal-payments/:transactionId`
- `POST /terminal-payments/:transactionId/cancel`

Creating a payment returns `202 Accepted` with the transaction state. The caller polls the status endpoint until a terminal state is reached. The accepted request shape is:

```json
{
  "transactionId": "order-123-payment-1",
  "terminalId": "tpe-counter-1",
  "amount": 1590,
  "currency": "EUR"
}
```

`amount` is an integer in cents and must be positive. The first release accepts only `EUR`. Payment endpoints require a bearer token matching the locally saved SmartEat user session. Terminal configuration mutations remain available only through Electron IPC.

## Payment State Model

Normalized states are:

- `queued`
- `connecting`
- `waiting_for_terminal`
- `waiting_for_card`
- `authorizing`
- `cancellation_requested`
- `approved`
- `declined`
- `cancelled`
- `failed`
- `unknown`

`approved`, `declined`, `cancelled`, `failed`, and `unknown` are terminal states. `unknown` means the agent cannot determine whether money moved and manual reconciliation is required. A timeout after a payment command was accepted by the TPE maps to `unknown`, not `failed`.

Normalized result fields include `transactionId`, `terminalId`, `state`, `amount`, `currency`, timestamps, a sanitized message, and available non-sensitive references. Raw terminal frames are excluded from the API and normal logs.

## Error Handling

Stable error codes include:

- `invalid_configuration`
- `unsupported_combination`
- `serial_port_not_found`
- `connection_refused`
- `connection_timeout`
- `protocol_mismatch`
- `terminal_busy`
- `terminal_declined`
- `cancellation_not_supported`
- `response_timeout_unknown_result`
- `authentication_required`

Transport errors occurring before any financial command is written produce `failed`. Errors after the command may have reached the terminal produce `unknown` unless the protocol provides a definitive result.

Cancellation is best-effort. Closing the socket or serial port is not treated as a financial cancellation. The state changes to `cancelled` only after a definitive terminal response.

## Security and Logging

- Cardholder data and PIN data never enter the agent.
- Raw protocol frames are disabled in normal logs.
- Debug logging redacts merchant IDs, tokens, authorization references, and any field not explicitly classified as safe.
- HTTP payment routes authenticate against the saved SmartEat session.
- Amount, currency, terminal ID, and transaction ID are validated in the main process.
- The agent does not expose terminal configuration write routes over HTTP.
- TCP targets are restricted to configured terminals; callers cannot provide an arbitrary host or COM port in a payment request.

## Testing Strategy

### Unit tests

- Configuration validation for every protocol/transport combination.
- Caisse-AP message fixtures and fragmented-response parsing.
- Nepting TLV encoding, decoding, required tags, and malformed frames.
- Payment state transitions, locking, idempotency, and timeout-to-unknown behavior.
- Error normalization and sensitive-field redaction.

### Transport tests

- A local TCP terminal simulator covers success, decline, cancellation, fragmented frames, disconnects, and timeouts.
- A serial loopback/fake transport covers the same exchange contract without requiring hardware in CI.
- Serial-port enumeration is abstracted so Windows results can be tested deterministically.

### Integration tests

- IPC handlers are exercised against fake protocol and transport adapters.
- HTTP endpoints are tested for authentication, validation, idempotency, busy terminals, and polling.
- The Vue production build verifies the new view is bundled.

### Hardware acceptance

The PAX Q25 is tested separately for each combination enabled by its installed payment application. A combination is marked verified only after connection, approved payment, declined payment, customer cancellation, response timeout, and restart recovery have been exercised. Tests use low-value authorized transactions and are reconciled against the terminal journal.

## Delivery Sequence

1. Add shared models, validation, transaction states, and fake adapters.
2. Add TCP and serial transport adapters.
3. Add Caisse-AP and Nepting protocol adapters with fixture tests.
4. Add `TerminalService`, persistence, locking, and idempotency.
5. Add IPC and authenticated local HTTP handlers.
6. Add the **Mes TPE** view and navigation.
7. Run automated verification and complete PAX Q25 hardware acceptance.

## Acceptance Criteria

- A user can create, edit, delete, enable, and test a PAX Q25 configuration.
- The UI exposes both protocols and both transports without conflating them.
- Windows USB serial ports can be listed and selected.
- Each configured and terminal-supported combination can complete a payment and return a normalized result.
- Duplicate requests with the same transaction ID cannot create a second payment.
- A lost response never triggers automatic retry on another protocol or transport.
- Concurrent payment requests to one terminal are rejected safely.
- No cardholder data or unredacted credentials appear in settings, API responses, or normal logs.
- `npm.cmd run verify` passes, and hardware-tested combinations are recorded explicitly.
