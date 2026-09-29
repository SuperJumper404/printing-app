const test = require("node:test");
const assert = require("node:assert/strict");

test("defines labels and editable fields for all ten transports", async () => {
  const { TRANSPORT_PRESENTATION } = await import(
    "../../src/printers/transportPresentation.mjs"
  );

  assert.deepEqual(
    TRANSPORT_PRESENTATION.map((item) => item.id),
    [
      "windowsRaw",
      "network9100",
      "ipp",
      "lpr",
      "eposHttp",
      "usbSerial",
      "bluetoothSerial",
      "usbRaw",
      "usbHid",
      "bluetoothGatt",
    ],
  );
  for (const transport of TRANSPORT_PRESENTATION) {
    assert.ok(transport.label);
    assert.ok(transport.fields.length > 0, `${transport.id} must expose config fields`);
  }
});

test("marks unavailable transports disabled and exposes their reason", async () => {
  const { getTransportRows } = await import(
    "../../src/printers/transportPresentation.mjs"
  );
  const [row] = getTransportRows({
    transports: {
      windowsRaw: {
        available: false,
        enabled: false,
        reason: "Pilote Windows absent",
        config: {},
      },
    },
  });

  assert.equal(row.id, "windowsRaw");
  assert.equal(row.controlDisabled, true);
  assert.equal(row.reason, "Pilote Windows absent");
});

test("preserves multiple enabled transports while merging saved configuration", async () => {
  const { mergePrinterConfiguration } = await import(
    "../../src/printers/transportPresentation.mjs"
  );
  const discovered = {
    id: "printer-one",
    ticketTypes: { caisse: false, cuisine: false },
    transports: {
      windowsRaw: { available: true, enabled: false, verified: false, config: { printerName: "Queue" } },
      usbSerial: { available: true, enabled: false, verified: false, config: { portName: "COM4" } },
    },
  };
  const saved = {
    id: "printer-one",
    ticketTypes: { caisse: true, cuisine: false },
    transports: {
      windowsRaw: { available: true, enabled: true, verified: true, config: {} },
      usbSerial: { available: true, enabled: true, verified: false, config: { baudRate: 19200 } },
    },
  };

  const merged = mergePrinterConfiguration(discovered, saved);
  assert.equal(merged.transports.windowsRaw.enabled, true);
  assert.equal(merged.transports.usbSerial.enabled, true);
  assert.equal(merged.transports.windowsRaw.verified, true);
  assert.equal(merged.transports.usbSerial.config.portName, "COM4");
  assert.equal(merged.transports.usbSerial.config.baudRate, 19200);
  assert.equal(merged.ticketTypes.caisse, true);
});
