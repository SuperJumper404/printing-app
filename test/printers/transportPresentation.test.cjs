const test = require("node:test");
const assert = require("node:assert/strict");

test("hidden and expanded preferences survive rediscovery, disconnect and reconnect without changing routing", async () => {
  const { mergeDiscoveredAndSavedPrinters, getPrinterList } = await import("../../src/printers/transportPresentation.mjs");
  const saved = [{ id: "counter", name: "Caisse", hidden: true, collapsed: false, favorite: true, instanceIds: ["USB\\DEVICE42"], ticketTypes: { caisse: true },
    transports: { usbSerial: { available: true, enabled: true, config: { portName: "COM4", baudRate: 19200 } } } }];
  const discovered = [{ id: "new-id", name: "New detection", hidden: false, collapsed: true, instanceIds: ["usb\\device42"],
    transports: { usbSerial: { available: true, config: { portName: "COM12" } } } }];
  const merged = mergeDiscoveredAndSavedPrinters(discovered, saved);
  assert.equal(merged[0].hidden, true);
  assert.equal(merged[0].collapsed, false);
  assert.equal(merged[0].transports.usbSerial.enabled, true);
  assert.equal(merged[0].transports.usbSerial.config.portName, "COM12");
  const offline = mergeDiscoveredAndSavedPrinters([], merged);
  const recovered = mergeDiscoveredAndSavedPrinters(discovered, offline);
  assert.equal(recovered[0].hidden, true);
  assert.equal(recovered[0].collapsed, false);
  assert.deepEqual(getPrinterList(recovered), []);
  assert.equal(getPrinterList(recovered, { hidden: true })[0].id, "counter");
});

test("printer views keep favorite ordering and allow a hidden printer to be restored", async () => {
  const { getPrinterList } = await import("../../src/printers/transportPresentation.mjs");
  const printers = [{ id: "regular" }, { id: "hidden", hidden: true }, { id: "favorite", favorite: true }, { id: "hidden-favorite", favorite: true, hidden: true }];
  assert.deepEqual(getPrinterList(printers).map(printer => printer.id), ["favorite", "regular"]);
  assert.deepEqual(getPrinterList(printers, { hidden: true }).map(printer => printer.id), ["hidden-favorite", "hidden"]);
  printers[1].hidden = false;
  assert.deepEqual(getPrinterList(printers).map(printer => printer.id), ["favorite", "regular", "hidden"]);
});

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
  const network9100 = TRANSPORT_PRESENTATION.find((item) => item.id === "network9100");
  assert.deepEqual(
    network9100.fields.map((field) => field.key),
    ["host", "port", "timeoutMs"],
  );
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
    ticketSource: "ticketData",
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
  assert.equal(merged.ticketSource, "ticketData");
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
  assert.equal(merged[0].name, "Counter saved");
  assert.equal(merged[0].transports.windowsRaw.enabled, true);
  assert.equal(merged[1].transports.network9100.enabled, true);
});

test("saved identity and favorite survive a moved COM port while baud rate remains configured", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const [printer] = mergeDiscoveredAndSavedPrinters([{
    id: "new-discovery-id", name: "Generic", instanceIds: ["USB\\SERIAL42"],
    transports: { usbSerial: { available: true, config: { portName: "COM12", baudRate: 9600 } } },
  }], [{
    id: "counter", name: "Caisse préférée", favorite: true, instanceIds: ["usb\\serial42"],
    transports: { usbSerial: { available: true, enabled: true, config: { portName: "COM4", baudRate: 19200 } } },
  }]);
  assert.equal(printer.id, "counter");
  assert.equal(printer.name, "Caisse préférée");
  assert.equal(printer.favorite, true);
  assert.equal(printer.transports.usbSerial.config.portName, "COM12");
  assert.equal(printer.transports.usbSerial.config.baudRate, 19200);
});

test("current IP replaces a saved endpoint without losing routing preferences", async () => {
  const { mergePrinterConfiguration } = await import("../../src/printers/transportPresentation.mjs");
  const printer = mergePrinterConfiguration({
    id: "new", addresses: ["10.2.3.44"],
    transports: { ipp: { available: true, config: { host: "10.2.3.44", port: 8631, path: "/ipp/new" } } },
  }, {
    id: "saved", favorite: true,
    transports: { ipp: { enabled: true, config: { host: "10.2.3.20", port: 631, path: "/ipp/old", timeoutMs: 5000 } } },
  });
  assert.equal(printer.transports.ipp.config.host, "10.2.3.44");
  assert.equal(printer.transports.ipp.config.port, 8631);
  assert.equal(printer.transports.ipp.config.path, "/ipp/new");
  assert.equal(printer.transports.ipp.config.timeoutMs, 5000);
  assert.equal(printer.transports.ipp.enabled, true);
});

test("absent favorites stay visible offline and recover their availability", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const saved = [{ id: "favorite", name: "Cuisine", favorite: true, transports: {
    network9100: { available: true, enabled: true, verified: true, config: { host: "10.0.0.8", port: 9100 } },
  } }];
  const offline = mergeDiscoveredAndSavedPrinters([], saved);
  assert.equal(offline[0].online, false);
  assert.equal(offline[0].transports.network9100.available, false);
  assert.equal(offline[0].transports.network9100.enabled, true);
  assert.equal(saved[0].transports.network9100.available, true);
  const recovered = mergeDiscoveredAndSavedPrinters([{ id: "favorite", transports: {
    network9100: { available: true, config: { host: "10.0.0.8", port: 9100 } },
  } }], offline);
  assert.equal(recovered[0].online, true);
  assert.equal(recovered[0].favorite, true);
  assert.equal(recovered[0].transports.network9100.enabled, true);
});

test("favorites sort first without shuffling their original relative order", async () => {
  const { sortPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const printers = [{ id: "b" }, { id: "z", favorite: true }, { id: "a" }, { id: "y", favorite: true }];
  assert.equal(typeof sortPrinters, "function");
  assert.deepEqual(sortPrinters(printers).map((item) => item.id), ["z", "y", "b", "a"]);
  assert.deepEqual(printers.map((item) => item.id), ["b", "z", "a", "y"]);
});

test("direct candidates stay visible but cannot enable before authorization", async () => {
  const { getTransportRows } = await import("../../src/printers/transportPresentation.mjs");
  const row = getTransportRows({ transports: { usbRaw: { candidate: true, available: false, needsAuthorization: true } } })
    .find((item) => item.id === "usbRaw");
  assert.equal(row.candidate, true);
  assert.equal(row.controlDisabled, true);
  assert.equal(row.canAuthorize, true);
});

test("discovery refresh merges preferences edited while discovery was in progress", async () => {
  const { createDiscoveryRefresh } = await import("../../src/printers/transportPresentation.mjs");
  assert.equal(typeof createDiscoveryRefresh, "function");
  let complete;
  let current = [{ id: "counter", name: "Caisse", favorite: false, transports: {} }];
  const refresh = createDiscoveryRefresh({
    getSaved: async () => [{ id: "counter", name: "Old", favorite: false }],
    discover: () => new Promise((resolve) => { complete = resolve; }),
    getCurrent: () => current,
    apply: (printers) => { current = printers; },
  });
  const pending = refresh.run();
  current[0].favorite = true;
  complete([{ id: "counter", name: "Detected", transports: {} }]);
  await pending;
  assert.equal(current[0].favorite, true);
  assert.equal(current[0].name, "Caisse");
});

test("discovery refresh never overlaps and discards completion after dispose", async () => {
  const { createDiscoveryRefresh } = await import("../../src/printers/transportPresentation.mjs");
  assert.equal(typeof createDiscoveryRefresh, "function");
  let complete;
  let discoveryCalls = 0;
  let applied = false;
  const refresh = createDiscoveryRefresh({
    getSaved: async () => [],
    discover: () => { discoveryCalls += 1; return new Promise((resolve) => { complete = resolve; }); },
    getCurrent: () => [], apply: () => { applied = true; },
  });
  const pending = refresh.run();
  assert.equal(refresh.run(), pending);
  assert.equal(discoveryCalls, 1);
  refresh.dispose();
  complete([]);
  await pending;
  assert.equal(applied, false);
});

test("expired discovery returns promptly without allowing a second concurrent hardware scan", async () => {
  const { createDiscoveryRefresh } = await import("../../src/printers/transportPresentation.mjs");
  assert.equal(typeof createDiscoveryRefresh, "function");
  let complete;
  let calls = 0;
  let applied = false;
  const refresh = createDiscoveryRefresh({
    getSaved: async () => [], discover: () => { calls += 1; return new Promise((resolve) => { complete = resolve; }); },
    getCurrent: () => [], apply: () => { applied = true; }, timeoutMs: 10,
  });
  await assert.rejects(refresh.run(), /délai/i);
  await assert.rejects(refresh.run(), /délai/i);
  assert.equal(calls, 1);
  complete([{ id: "late" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(applied, false);
  refresh.dispose();
});

test("a reused address cannot transfer saved routing to a different hardware identity", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const printers = mergeDiscoveredAndSavedPrinters([{
    id: "new", containerId: "NEW", serialNumber: "TWO", addresses: ["10.0.0.8"], transports: {},
  }], [{ id: "old", favorite: true, containerId: "OLD", serialNumber: "ONE", addresses: ["10.0.0.8"], transports: { network9100: { enabled: true } } }]);
  assert.equal(printers.length, 2);
  assert.equal(printers.find((printer) => printer.id === "old").detected, false);
  assert.equal(printers.find((printer) => printer.id === "new").transports.network9100.enabled, false);
});

test("a conflicting container without serial numbers does not match by a reused IP", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const printers = mergeDiscoveredAndSavedPrinters([{ id: "new", containerId: "NEW", addresses: ["10.0.0.8"], transports: {} }],
    [{ id: "old", containerId: "OLD", addresses: ["10.0.0.8"], favorite: true, transports: {} }]);
  assert.equal(printers.length, 2);
});

test("ambiguous saved address matches do not pick a configured printer arbitrarily", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const printers = mergeDiscoveredAndSavedPrinters([{ id: "new", addresses: ["10.0.0.8"], transports: {} }],
    [{ id: "old-a", addresses: ["10.0.0.8"], transports: {} }, { id: "old-b", addresses: ["10.0.0.8"], transports: {} }]);
  assert.equal(printers.length, 3);
});

test("a main-process offline snapshot remains offline when the UI merges preferences", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const [printer] = mergeDiscoveredAndSavedPrinters([{ id: "counter", detected: false, online: false, transports: {} }],
    [{ id: "counter", favorite: true, transports: {} }]);
  assert.equal(printer.detected, false);
  assert.equal(printer.online, false);
});

test("invalidating a refresh discards its old result while retaining the overlap guard", async () => {
  const { createDiscoveryRefresh } = await import("../../src/printers/transportPresentation.mjs");
  let complete;
  let calls = 0;
  let applied = false;
  const refresh = createDiscoveryRefresh({
    getSaved: async () => [], getCurrent: () => [], apply: () => { applied = true; },
    discover: () => { calls += 1; return new Promise((resolve) => { complete = resolve; }); },
  });
  const pending = refresh.run();
  assert.equal(typeof refresh.invalidate, "function");
  refresh.invalidate();
  assert.equal(refresh.run(), pending);
  assert.equal(calls, 1);
  complete([{ id: "deleted" }]);
  await pending;
  assert.equal(applied, false);
  refresh.dispose();
});

test("stable mDNS relocation updates an enabled network route even when its probe was missed", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const [printer] = mergeDiscoveredAndSavedPrinters([{
    id: "p", networkIdentity: "Caisse._ipp._tcp.local", addresses: ["10.0.0.8"],
    transports: { ipp: { available: true, config: { host: "10.0.0.8", port: 631 } } },
  }], [{
    id: "p", favorite: true, networkIdentity: "Caisse._ipp._tcp.local", addresses: ["10.0.0.7"],
    transports: {
      network9100: { enabled: true, config: { host: "10.0.0.7", port: 9200, timeoutMs: 12000 } },
      lpr: { enabled: true, config: { host: "10.0.0.7", port: 515, queueName: "kitchen" } },
      eposHttp: { enabled: false, config: { host: "10.0.0.99", port: 8080, deviceId: "manual" } },
    },
  }]);
  assert.equal(printer.transports.network9100.config.host, "10.0.0.8");
  assert.equal(printer.transports.network9100.config.port, 9200);
  assert.equal(printer.transports.network9100.config.timeoutMs, 12000);
  assert.equal(printer.transports.network9100.enabled, true);
  assert.equal(printer.transports.lpr.config.host, "10.0.0.8");
  assert.equal(printer.transports.lpr.config.queueName, "kitchen");
  assert.equal(printer.transports.eposHttp.config.host, "10.0.0.99");
});

test("newly favorited printers move ahead of existing favorites and unfavoriting preserves the remaining order", async () => {
  const { togglePrinterFavorite } = await import("../../src/printers/transportPresentation.mjs");
  assert.equal(typeof togglePrinterFavorite, "function");
  const original = [{ id: "one", favorite: true }, { id: "two", favorite: true }, { id: "new" }, { id: "normal" }];
  const favored = togglePrinterFavorite(original, "new");
  assert.deepEqual(favored.map((printer) => printer.id), ["new", "one", "two", "normal"]);
  assert.equal(favored[0].favorite, true);
  assert.equal(original[2].favorite, undefined);
  const removed = togglePrinterFavorite(favored, "new");
  assert.deepEqual(removed.map((printer) => printer.id), ["one", "two", "new", "normal"]);
  assert.equal(removed[2].favorite, false);
});

test("full discovery and merge pipeline reserves a moved favorite for its current mDNS identity", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const { correlatePrinterObservations } = require("../../lib/printers/correlateDevices");
  const observation = (host, identity) => ({
    id: identity ? `mdns:${identity}` : `network:${host}`,
    observationId: identity ? `mdns:${identity}` : `network:${host}`,
    source: identity ? "mdns" : "network", ...(identity ? { networkIdentity: identity } : {}),
    addresses: [host], ip: host,
    transports: { network9100: { available: true, config: { host, port: 9100 } } },
  });
  const saved = [{
    id: "printer-zzzz", favorite: true, networkIdentity: "old._ipp._tcp.local", addresses: ["10.0.0.7"],
    observations: [observation("10.0.0.7", "old._ipp._tcp.local"), observation("10.0.0.7")],
    transports: { network9100: { enabled: true, config: { host: "10.0.0.7", port: 9100 } } },
  }];
  const discovered = correlatePrinterObservations([
    observation("10.0.0.8", "old._ipp._tcp.local"), observation("10.0.0.8"),
    observation("10.0.0.7", "new._ipp._tcp.local"), observation("10.0.0.7"),
  ], [{ printerId: "printer-zzzz", observationIds: saved[0].observations.map((item) => item.observationId) }]);
  const merged = mergeDiscoveredAndSavedPrinters(discovered, saved);
  assert.equal(merged.length, 2);
  assert.equal(new Set(merged.map((printer) => printer.id)).size, 2);
  const favorite = merged.find((printer) => printer.id === "printer-zzzz");
  assert.equal(favorite.networkIdentity, "old._ipp._tcp.local");
  assert.equal(favorite.favorite, true);
  assert.equal(favorite.transports.network9100.enabled, true);
  assert.equal(favorite.transports.network9100.config.host, "10.0.0.8");
  const newPrinter = merged.find((printer) => printer.networkIdentity === "new._ipp._tcp.local");
  assert.equal(newPrinter.favorite, false);
  assert.equal(newPrinter.transports.network9100.enabled, false);
});

test("shared secondary mDNS aliases preserve preferences when the primary service changes", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const [printer] = mergeDiscoveredAndSavedPrinters([{
    id: "changed-primary", networkIdentity: "Caisse._pdl-datastream._tcp.local", addresses: ["10.0.0.8"],
    observations: [{ observationId: "mdns:Caisse._pdl-datastream._tcp.local" }], transports: {},
  }], [{
    id: "favorite", favorite: true, networkIdentity: "Caisse._ipp._tcp.local", addresses: ["10.0.0.7"],
    observations: [{ observationId: "mdns:Caisse._ipp._tcp.local" }, { observationId: "mdns:Caisse._pdl-datastream._tcp.local" }],
    transports: {},
  }]);
  assert.equal(printer.id, "favorite");
  assert.equal(printer.favorite, true);
});

test("an unmatched IP-only record cannot consume preferences reserved for a later exact printer ID", async () => {
  const { mergeDiscoveredAndSavedPrinters } = await import("../../src/printers/transportPresentation.mjs");
  const merged = mergeDiscoveredAndSavedPrinters([
    { id: "a-new", addresses: ["10.0.0.7"], transports: {} },
    { id: "printer-zzzz", addresses: ["10.0.0.8"], transports: {} },
  ], [{ id: "printer-zzzz", favorite: true, addresses: ["10.0.0.7"], transports: {} }]);
  assert.equal(new Set(merged.map((printer) => printer.id)).size, 2);
  assert.equal(merged.find((printer) => printer.id === "a-new").favorite, false);
  assert.equal(merged.find((printer) => printer.id === "printer-zzzz").favorite, true);
});
