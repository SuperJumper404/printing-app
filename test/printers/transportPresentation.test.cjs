const test = require("node:test");
const assert = require("node:assert/strict");

test("defines labels and editable fields for all ten transports", async () => {
  const { PRINTER_ENCODING_OPTIONS, TRANSPORT_PRESENTATION } = await import(
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
  assert.deepEqual(
    PRINTER_ENCODING_OPTIONS.map((item) => item.value),
    ["auto", "cp858", "cp850", "windows-1252", "utf8", "gb18030", "raw"],
  );
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
    encoding: "cp858",
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
  assert.equal(merged.encoding, "cp858");
});

test("keeps enabled saved printers that are not detected yet", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import(
    "../../src/printers/transportPresentation.mjs"
  );
  const discovered = [{
    id: "counter",
    name: "Counter detected",
    transports: {
      windowsRaw: { available: true, enabled: false, verified: false, config: {} },
    },
  }];
  const saved = [
    {
      id: "counter",
      name: "Counter saved",
      transports: {
        windowsRaw: { available: true, enabled: true, verified: true, config: {} },
      },
    },
    {
      id: "kitchen",
      name: "Kitchen",
      transports: {
        network9100: {
          available: true,
          enabled: true,
          verified: true,
          config: { host: "192.168.1.40", port: 9100 },
        },
      },
    },
  ];

  const merged = mergeDiscoveredAndSavedPrinters(discovered, saved);

  assert.deepEqual(merged.map((item) => item.id), ["counter", "kitchen"]);
  assert.equal(merged[0].name, "Counter detected");
  assert.equal(merged[0].transports.windowsRaw.enabled, true);
  assert.equal(merged[1].transports.network9100.enabled, true);
});
