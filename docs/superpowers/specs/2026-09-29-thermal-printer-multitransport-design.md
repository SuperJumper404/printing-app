# Thermal Printer Multi-Transport Design

## Objective

Make SmartEat Printer Agent detect as many Windows-connected thermal receipt
printers as practical and let the user send the same ESC/POS payload over one
or more explicitly enabled transports.

Discovery is broad and non-destructive. Printing is opt-in: newly discovered
devices have every ESC/POS transport disabled until the user enables and tests
it.

## Scope

The feature targets Windows thermal receipt printers that accept ESC/POS over
at least one supported transport:

- Windows printer queues using RAW jobs
- Network TCP port 9100
- IPP port 631
- LPR port 515
- Epson ePOS HTTP port 80
- USB serial ports
- Bluetooth Classic serial ports
- Raw USB bulk endpoints
- USB HID output reports
- Bluetooth Low Energy GATT write characteristics

Discovery includes devices that cannot currently be opened. Such devices stay
visible with a precise availability reason so that detection is never confused
with print compatibility.

## Non-Goals

- Automatically changing or replacing Windows device drivers
- Automatically enabling a transport based only on VID/PID or device name
- Claiming that every detected USB or Bluetooth device supports ESC/POS
- Supporting StarPRNT, ZPL, TSPL, CPCL, or proprietary printer languages in
  this iteration
- Sending probe data to arbitrary devices during discovery
- Supporting non-Windows direct-device backends in this iteration

## Design Principles

1. Detect broadly, print narrowly.
2. Keep discovery separate from transport communication.
3. Preserve every observed transport for a physical printer.
4. Never stop one selected transport because another selected transport fails.
5. Never modify a Windows driver automatically.
6. Report partial success per transport.

## Architecture

The main process will be split into four responsibilities:

1. Discovery adapters collect observations from Windows, the network, USB, HID,
   and Bluetooth.
2. A normalizer converts observations into one shared device shape.
3. A correlation layer groups observations that represent the same physical
   printer when a reliable key is available.
4. Transport adapters send ESC/POS bytes through the user-selected channels.

`index.js` remains the IPC and application composition layer. Discovery,
correlation, and transport-specific implementation move into focused modules
under `lib/printers/` so they can be tested without starting Electron.

## Discovery Sources

### Windows Printer Queues

Use `Get-Printer` and `Get-PrinterPort` without brand or model filters. Preserve
queue name, driver, port, status, and port type. Queues may represent USB,
Bluetooth, TCP/IP, WSD, COM, LPT, or virtual ports.

Only queues with a usable destination are offered for Windows RAW ESC/POS. A
virtual queue may still be displayed, but it must not be assumed to be a
thermal printer.

### Windows Plug and Play

Use `Get-PnpDevice -PresentOnly`, `Get-PnpDeviceProperty`, and CIM fallbacks to
collect:

- instance ID and container ID
- hardware IDs, VID, and PID
- serial number when exposed
- manufacturer, product, class, and service
- parent device
- location information and location paths
- driver and device status

Relevant PnP observations include USB printer-class devices, USB serial
devices, HID devices, Bluetooth devices, and composite-device children.

### Serial Ports

Enumerate all present COM ports, then classify each as USB, Bluetooth Classic,
or local from its PnP ancestry. Preserve configurable serial settings, with
defaults of 9600 baud, 8 data bits, no parity, and one stop bit.

### Network

Keep Bonjour/mDNS discovery and explicit subnet scanning. Probe only known
printing ports with bounded timeouts: 9100, 631, 515, and 80. Also ingest
installed Windows TCP/IP and WSD queues so printers outside the scanned subnet
remain visible.

### Raw USB

Enumerate USB descriptors and interfaces. Record bulk OUT/IN endpoints and
printer-class interfaces. Raw USB is marked available only when the process can
open and claim the relevant interface without changing its driver.

If `usbprint.sys` owns the interface, the device remains detected and the raw
USB transport reports that Windows controls the interface. The application
must not install WinUSB or replace the driver.

### HID

Enumerate HID collections and output capabilities. HID is marked testable only
when an output report path is available. Detection alone does not imply ESC/POS
support.

### Bluetooth

Bluetooth Classic printing is exposed through Windows queues or serial COM
ports. BLE discovery records GATT services and writable characteristics. A BLE
transport is testable only after a writable characteristic is selected or a
known profile supplies it.

## Unified Device Model

Each physical printer is represented by a stable record:

```js
{
  id,
  name,
  manufacturer,
  vendorId,
  productId,
  serialNumber,
  instanceIds: [],
  containerId,
  addresses: [],
  observations: [],
  transports: {
    windowsRaw: { available, enabled, config, reason },
    network9100: { available, enabled, config, reason },
    ipp: { available, enabled, config, reason },
    lpr: { available, enabled, config, reason },
    eposHttp: { available, enabled, config, reason },
    usbSerial: { available, enabled, config, reason },
    bluetoothSerial: { available, enabled, config, reason },
    usbRaw: { available, enabled, config, reason },
    usbHid: { available, enabled, config, reason },
    bluetoothGatt: { available, enabled, config, reason }
  },
  escposVerifiedTransports: []
}
```

Transport configuration stores only the fields needed by that adapter, such as
queue name, IP and port, COM settings, USB interface and endpoint, HID report
ID, or BLE service and characteristic UUIDs.

## Correlation And Deduplication

Observations are merged only when there is reliable evidence. Correlation keys,
from strongest to weakest, are:

1. Windows container ID
2. Device serial number plus VID/PID
3. PnP parent/child relationship
4. Exact printer queue to port/device relationship
5. Saved user association

Name-only and VID/PID-only matches are not sufficient because models and USB
controllers can be reused. When correlation is uncertain, devices remain
separate and the user may associate them manually.

## ESC/POS Activation And Testing

All transports are disabled on first discovery. The UI displays every detected
transport with one of these states:

- available
- detected but unavailable, with a reason
- enabled but not verified
- verified by a successful user-confirmed test

The test action sends a small ESC/POS ticket over every enabled transport. A
successful write means only that the transport accepted the bytes. The UI asks
the user to confirm that a readable ticket was physically printed before
adding the transport to `escposVerifiedTransports`.

The user can enable multiple transports. This is intentionally cumulative, not
fallback behavior: enabling two transports sends the ticket twice.

## Print Routing

For every print job:

1. Build the ESC/POS payload once.
2. Resolve all enabled transports for all matching printers.
3. Dispatch every transport independently with `Promise.allSettled()` semantics.
4. Record one result per printer and transport.
5. Return aggregate success when at least one selected transport succeeds, while
   preserving every failure for logs and UI feedback.

A transport failure never cancels another transport. Timeouts are adapter
specific and all handles, ports, interfaces, and connections are closed in
`finally` blocks.

## User Interface

The printer view shows one card per correlated physical printer. The card
contains identity details and a flat list of transport toggles. Unavailable
transports are disabled and display their reason. Advanced fields appear only
for their transport, for example serial speed, USB endpoint, HID report ID, or
BLE characteristic.

The test result lists every attempted transport separately. Confirmation that
the paper ticket printed correctly is also per transport.

## Persistence And Migration

Saved configurations migrate from the current `protocols` and
`availableProtocols` fields into the new transport records. Existing enabled
Windows spooler, COM, and network settings remain enabled after migration.

Stable hardware identity is preferred over display names. Local secrets and
device information continue to stay in `settings.json`, which must not be
committed.

## Error Handling

Expected failures receive user-facing categories:

- driver missing
- Windows owns the USB interface
- access denied
- endpoint or characteristic unavailable
- port already open
- device disconnected
- timeout
- unsupported platform or native module
- ESC/POS output not confirmed

Technical details are written to the existing debug log without exposing auth
tokens or unrelated private settings.

## Testing Strategy

Unit tests cover normalization, VID/PID parsing, correlation, migration,
transport selection, multi-transport dispatch, partial failures, and result
aggregation. Transport adapters use injected system boundaries so tests can
exercise behavior without physical hardware.

Windows integration tests verify PowerShell JSON output parsing. Manual hardware
tests cover at least:

- one Windows USB printer queue
- one USB serial ESC/POS printer
- one TCP 9100 printer
- one raw USB device when the interface is accessible
- one HID or BLE printer when suitable hardware is available

The web build, Node syntax checks, unit suites, Electron development launch, and
packaged Windows build must pass before release.

## Delivery Order

1. Introduce the unified model, migration, correlation, and broad Windows
   discovery while preserving existing transports.
2. Extract and test the multi-transport dispatcher.
3. Add raw USB discovery and sending.
4. Add HID discovery and sending.
5. Add BLE GATT discovery and sending.
6. Complete LPR and validate all packaging paths for native dependencies.

Each stage leaves unsupported transports visible but disabled and does not
regress Windows queue, network 9100, or serial printing.

## Acceptance Criteria

- Discovery uses no brand or model allowlist by default.
- All present Windows queues and relevant PnP, COM, USB, HID, Bluetooth, and
  network observations are collected.
- Duplicate observations are merged only with reliable evidence.
- No ESC/POS transport is enabled automatically for a new device.
- Users can enable and test multiple transports on one printer.
- Every enabled transport receives each print job independently.
- Failures are reported per transport and do not cancel successful sends.
- The application never replaces a Windows driver automatically.
- Existing saved printer configurations migrate without losing enabled routes.
- Unsupported printer languages remain explicitly out of scope.
