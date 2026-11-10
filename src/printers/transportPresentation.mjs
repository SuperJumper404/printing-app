const serialFields = [
  { key: "portName", label: "Port COM", type: "text", placeholder: "COM4" },
  { key: "baudRate", label: "Débit", type: "number", min: 300, max: 921600 },
  { key: "dataBits", label: "Bits", type: "number", min: 5, max: 8 },
  {
    key: "parity",
    label: "Parité",
    type: "select",
    options: ["None", "Even", "Odd", "Mark", "Space"],
  },
  { key: "stopBits", label: "Bits d'arrêt", type: "number", min: 1, max: 2 },
];

const networkFields = (defaultPort) => [
  { key: "host", label: "Adresse", type: "text", placeholder: "192.168.1.30" },
  { key: "port", label: "Port", type: "number", min: 1, max: 65535, defaultValue: defaultPort },
];

const networkEscPosFields = [
  ...networkFields(9100),
  { key: "timeoutMs", label: "Délai (ms)", type: "number", min: 1000, max: 60000, defaultValue: 15000 },
];

export const PRINTER_ENCODING_OPTIONS = [
  { value: "auto", label: "Automatique" },
  { value: "cp858", label: "CP858 (Europe / euro)" },
  { value: "cp850", label: "CP850 (Europe)" },
  { value: "windows-1252", label: "Windows-1252" },
  { value: "utf8", label: "UTF-8" },
  { value: "gb18030", label: "GB18030" },
  { value: "raw", label: "Brut (aucune conversion)" },
];

export const TRANSPORT_PRESENTATION = [
  {
    id: "windowsRaw",
    label: "File Windows RAW",
    family: "Windows",
    fields: [
      { key: "printerName", label: "Nom de la file", type: "text" },
      { key: "portName", label: "Port Windows", type: "text" },
    ],
  },
  { id: "network9100", label: "ESC/POS réseau", family: "Réseau", fields: networkEscPosFields },
  {
    id: "ipp",
    label: "IPP",
    family: "Réseau",
    fields: [...networkFields(631), { key: "path", label: "Chemin", type: "text", placeholder: "/ipp/print" }],
  },
  {
    id: "lpr",
    label: "LPR",
    family: "Réseau",
    fields: [...networkFields(515), { key: "queueName", label: "File LPR", type: "text", placeholder: "lp" }],
  },
  {
    id: "eposHttp",
    label: "Epson ePOS HTTP",
    family: "Réseau",
    fields: [
      ...networkFields(80),
      { key: "deviceId", label: "Identifiant", type: "text", placeholder: "local_printer" },
      { key: "timeout", label: "Délai (ms)", type: "number", min: 1000, max: 30000 },
    ],
  },
  { id: "usbSerial", label: "USB série", family: "USB / COM", fields: serialFields },
  { id: "bluetoothSerial", label: "Bluetooth série", family: "Bluetooth", fields: serialFields },
  {
    id: "usbRaw",
    label: "USB direct",
    family: "USB",
    fields: [
      { key: "vendorId", label: "VID", type: "text" },
      { key: "productId", label: "PID", type: "text" },
      { key: "interfaceNumber", label: "Interface", type: "number", min: 0, max: 255 },
      { key: "endpointNumber", label: "Endpoint OUT", type: "number", min: 1, max: 255 },
    ],
  },
  {
    id: "usbHid",
    label: "USB HID",
    family: "USB",
    fields: [
      { key: "vendorId", label: "VID", type: "text" },
      { key: "productId", label: "PID", type: "text" },
      { key: "reportId", label: "Report ID", type: "number", min: 0, max: 255 },
      { key: "packetSize", label: "Taille paquet", type: "number", min: 1, max: 1024 },
    ],
  },
  {
    id: "bluetoothGatt",
    label: "Bluetooth GATT",
    family: "Bluetooth",
    fields: [
      { key: "deviceId", label: "Périphérique", type: "text" },
      { key: "serviceUuid", label: "UUID service", type: "text" },
      { key: "characteristicUuid", label: "UUID caractéristique", type: "text" },
      { key: "maxChunkSize", label: "Taille fragment", type: "number", min: 1, max: 512 },
    ],
  },
];

function blankTransport(reason = "Non détecté") {
  return {
    available: false,
    enabled: false,
    verified: false,
    candidate: false,
    needsAuthorization: false,
    config: {},
    reason,
  };
}

export function getTransportRows(printer) {
  return TRANSPORT_PRESENTATION.map((presentation) => {
    const transport = printer?.transports?.[presentation.id] || blankTransport();
    return {
      ...presentation,
      ...transport,
      config: transport.config || {},
      controlDisabled: !transport.available && !transport.enabled,
      configDisabled: !transport.available && !transport.candidate && !transport.enabled,
      canAuthorize: ["usbRaw", "usbHid", "bluetoothGatt"].includes(presentation.id) &&
        Boolean(transport.available || transport.candidate || transport.enabled),
      reason: transport.reason || (!transport.available ? "Non détecté" : null),
    };
  });
}

export function createEmptyTransports() {
  return Object.fromEntries(
    TRANSPORT_PRESENTATION.map(({ id }) => [id, blankTransport()]),
  );
}

export function mergePrinterConfiguration(discovered, saved) {
  saved ||= {};
  const transports = {};
  const networkIds = ["network9100", "ipp", "lpr", "eposHttp"];
  const hostChanges = new Map();
  const freshHosts = new Set(networkIds.map((id) => discovered.transports?.[id]?.config?.host).filter(Boolean));
  if (freshHosts.size === 0) for (const host of discovered.addresses || []) freshHosts.add(host);
  const priorHosts = new Set([
    ...(saved.addresses || []),
    ...(saved.observations || []).flatMap((item) => [...(item.addresses || []), item.ip]),
  ].filter(Boolean));
  if (priorHosts.size === 0) {
    const configuredHosts = new Set(networkIds.map((id) => saved.transports?.[id]?.config?.host).filter(Boolean));
    if (configuredHosts.size === 1) for (const host of configuredHosts) priorHosts.add(host);
  }
  if (freshHosts.size === 1) {
    const [host] = freshHosts;
    for (const previousHost of priorHosts) hostChanges.set(previousHost, host);
  }
  for (const id of networkIds) {
    const previousHost = saved.transports?.[id]?.config?.host;
    const currentHost = discovered.transports?.[id]?.config?.host;
    if (previousHost && currentHost) hostChanges.set(previousHost, currentHost);
  }
  for (const { id } of TRANSPORT_PRESENTATION) {
    const current = discovered.transports?.[id] || blankTransport();
    const previous = saved.transports?.[id];
    const config = { ...(current.config || {}), ...(previous?.config || {}) };
    const endpointKeys = {
      windowsRaw: ["printerName", "portName", "driverName"],
      network9100: ["host", "port"],
      ipp: ["host", "port", "path", "secure"],
      lpr: ["host", "port"],
      eposHttp: ["host", "port"],
      usbSerial: ["portName"],
      bluetoothSerial: ["portName"],
      usbRaw: ["vendorId", "productId", "serialNumber"],
      usbHid: ["vendorId", "productId", "serialNumber"],
      bluetoothGatt: ["deviceId"],
    }[id];
    for (const key of endpointKeys) {
      if (current.config?.[key] !== undefined && current.config[key] !== null && current.config[key] !== "") {
        config[key] = current.config[key];
      }
    }
    if (networkIds.includes(id) && !current.config?.host && hostChanges.has(config.host)) {
      config.host = hostChanges.get(config.host);
    }
    const authorizedCandidate = current.candidate && config.authorized === true &&
      (id !== "bluetoothGatt" || Boolean(config.serviceUuid && config.characteristicUuid));
    transports[id] = {
      ...current,
      available: Boolean(current.available || authorizedCandidate),
      needsAuthorization: Boolean(current.needsAuthorization && !authorizedCandidate),
      enabled: previous?.enabled ?? current.enabled ?? false,
      verified: previous?.verified ?? current.verified ?? false,
      reason: authorizedCandidate ? null : current.reason,
      config,
    };
  }

  return {
    ...saved,
    ...discovered,
    id: saved.id || discovered.id,
    name: saved.name || discovered.name,
    favorite: Boolean(saved.favorite ?? discovered.favorite),
    hidden: Boolean(saved.hidden ?? discovered.hidden),
    collapsed: saved.collapsed ?? discovered.collapsed ?? true,
    online: discovered.online ?? true,
    detected: discovered.detected ?? true,
    encoding: saved.encoding || discovered.encoding || "auto",
    escPosCodePage: saved.escPosCodePage ?? discovered.escPosCodePage ?? null,
    charsPerLine: saved.charsPerLine || discovered.charsPerLine || 48,
    ticketTypes: {
      caisse: false,
      cuisine: false,
      ...(saved.ticketTypes || discovered.ticketTypes || {}),
    },
    ticketSource: saved.ticketSource || discovered.ticketSource || "received",
    transports,
  };
}

function printersMatch(left, right) {
  const normalize = (value) => String(value || "").trim().toUpperCase();
  const mdnsAliases = (printer) => new Set([
    printer.networkIdentity,
    ...(printer.observations || []).flatMap((item) => [
      item.networkIdentity,
      ...[item.observationId, item.id].filter((id) => /^mdns:/i.test(id || "")).map((id) => id.slice(5)),
    ]),
  ].filter(Boolean).map(normalize));
  const leftAliases = mdnsAliases(left);
  const rightAliases = mdnsAliases(right);
  if (leftAliases.size && rightAliases.size) return [...leftAliases].some((id) => rightAliases.has(id));
  if (left.id && left.id === right.id) return true;
  if (left.containerId && normalize(left.containerId) === normalize(right.containerId)) return true;
  if (
    left.serialNumber &&
    left.vendorId && left.productId &&
    normalize(left.serialNumber) === normalize(right.serialNumber) &&
    normalize(left.vendorId) === normalize(right.vendorId) &&
    normalize(left.productId) === normalize(right.productId)
  ) return true;
  const ids = (printer) => new Set([
    ...(printer.instanceIds || []),
    ...(printer.observations || []).flatMap((item) => [item.observationId, ...(item.instanceIds || [])]),
  ].filter(Boolean).map(normalize));
  const rightIds = ids(right);
  if ([...ids(left)].some((id) => rightIds.has(id))) return true;
  if (left.containerId && right.containerId && normalize(left.containerId) !== normalize(right.containerId)) return false;
  if (left.networkIdentity && right.networkIdentity && normalize(left.networkIdentity) !== normalize(right.networkIdentity)) return false;
  if (left.vendorId && right.vendorId && normalize(left.vendorId) !== normalize(right.vendorId)) return false;
  if (left.productId && right.productId && normalize(left.productId) !== normalize(right.productId)) return false;
  if (left.serialNumber && right.serialNumber && normalize(left.serialNumber) !== normalize(right.serialNumber)) return false;
  return (left.addresses || []).some((address) => right.addresses?.includes(address));
}

export function sortPrinters(printers = []) {
  return [...printers].sort((left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite)));
}

export function getPrinterList(printers = [], { hidden = false } = {}) {
  return sortPrinters(printers.filter((printer) => Boolean(printer.hidden) === hidden));
}

export function togglePrinterFavorite(printers, printerId) {
  const selected = printers.find((printer) => printer.id === printerId);
  if (!selected) return sortPrinters(printers);
  const updated = { ...selected, favorite: !selected.favorite };
  const ordered = updated.favorite
    ? [updated, ...printers.filter((printer) => printer.id !== printerId)]
    : printers.map((printer) => printer.id === printerId ? updated : printer);
  return sortPrinters(ordered);
}

export function createDiscoveryRefresh({ getSaved, discover, getCurrent, apply, timeoutMs = 20000 }) {
  let pending = null;
  let disposed = false;
  let timer;
  let generation = 0;
  return {
    run() {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      const startedGeneration = generation;
      let expired = false;
      let source;
      try { source = Promise.all([getSaved(), discover()]); } catch (error) { return Promise.reject(error); }
      const operation = source.then(([saved, discovered]) => {
        if (disposed || expired || startedGeneration !== generation) return;
        const current = getCurrent();
        const preferences = [...current, ...saved.filter((printer) => !current.some((item) => printersMatch(item, printer)))];
        apply(mergeDiscoveredAndSavedPrinters(discovered, preferences));
      });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error("Le délai de recherche est dépassé. Réessayez.")); }, timeoutMs);
      });
      pending = Promise.race([operation, timeout]);
      // Keep the overlap guard until the hardware operation actually settles.
      operation.then(() => { clearTimeout(timer); pending = null; }, () => { clearTimeout(timer); pending = null; });
      return pending;
    },
    invalidate() { generation += 1; },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}

export function mergeDiscoveredAndSavedPrinters(discovered = [], saved = []) {
  const remainingSaved = [...saved];
  const discoveredIds = new Set(discovered.map((printer) => printer.id).filter(Boolean));
  const merged = discovered.map((printer) => {
    const exactIndex = remainingSaved.findIndex((item) => item.id && item.id === printer.id && printersMatch(printer, item));
    const matches = remainingSaved.map((item, index) => {
      if (item.id !== printer.id && discoveredIds.has(item.id)) return -1;
      return printersMatch(printer, item) ? index : -1;
    }).filter((index) => index >= 0);
    const savedIndex = exactIndex >= 0 ? exactIndex : matches.length === 1 ? matches[0] : -1;
    if (savedIndex < 0) return mergePrinterConfiguration(printer);
    const [savedPrinter] = remainingSaved.splice(savedIndex, 1);
    return mergePrinterConfiguration(printer, savedPrinter);
  });
  const offline = remainingSaved.map((printer) => ({
    ...printer,
    online: false,
    detected: false,
    transports: Object.fromEntries(TRANSPORT_PRESENTATION.map(({ id }) => [id, {
      ...blankTransport(),
      ...printer.transports?.[id],
      config: { ...(printer.transports?.[id]?.config || {}) },
      available: false,
      candidate: false,
      reason: "Imprimante non détectée lors de la dernière recherche",
    }])),
  }));
  // Keep persisted order within each group, regardless of discovery completion order.
  const order = new Map(saved.map((printer, index) => [printer.id, index]));
  return sortPrinters([...merged, ...offline].sort((left, right) =>
    (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  ));
}
