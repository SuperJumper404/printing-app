const serialFields = [
  { key: "portName", label: "Port COM", type: "text", placeholder: "COM4" },
  { key: "baudRate", label: "Debit", type: "number", min: 300, max: 921600 },
  { key: "dataBits", label: "Bits", type: "number", min: 5, max: 8 },
  {
    key: "parity",
    label: "Parite",
    type: "select",
    options: ["None", "Even", "Odd", "Mark", "Space"],
  },
  { key: "stopBits", label: "Bits d'arret", type: "number", min: 1, max: 2 },
];

const networkFields = (defaultPort) => [
  { key: "host", label: "Adresse", type: "text", placeholder: "192.168.1.30" },
  { key: "port", label: "Port", type: "number", min: 1, max: 65535, defaultValue: defaultPort },
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
  { id: "network9100", label: "ESC/POS reseau", family: "Reseau", fields: networkFields(9100) },
  {
    id: "ipp",
    label: "IPP",
    family: "Reseau",
    fields: [...networkFields(631), { key: "path", label: "Chemin", type: "text", placeholder: "/ipp/print" }],
  },
  {
    id: "lpr",
    label: "LPR",
    family: "Reseau",
    fields: [...networkFields(515), { key: "queueName", label: "File LPR", type: "text", placeholder: "lp" }],
  },
  {
    id: "eposHttp",
    label: "Epson ePOS HTTP",
    family: "Reseau",
    fields: [
      ...networkFields(80),
      { key: "deviceId", label: "Identifiant", type: "text", placeholder: "local_printer" },
      { key: "timeout", label: "Delai (ms)", type: "number", min: 1000, max: 30000 },
    ],
  },
  { id: "usbSerial", label: "USB serie", family: "USB / COM", fields: serialFields },
  { id: "bluetoothSerial", label: "Bluetooth serie", family: "Bluetooth", fields: serialFields },
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
      { key: "deviceId", label: "Peripherique", type: "text" },
      { key: "serviceUuid", label: "UUID service", type: "text" },
      { key: "characteristicUuid", label: "UUID caracteristique", type: "text" },
      { key: "maxChunkSize", label: "Taille fragment", type: "number", min: 1, max: 512 },
    ],
  },
];

function blankTransport(reason = "Non detecte") {
  return {
    available: false,
    enabled: false,
    verified: false,
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
      controlDisabled: !transport.available,
      reason: transport.reason || (!transport.available ? "Non detecte" : null),
    };
  });
}

export function createEmptyTransports() {
  return Object.fromEntries(
    TRANSPORT_PRESENTATION.map(({ id }) => [id, blankTransport()]),
  );
}

export function mergePrinterConfiguration(discovered, saved) {
  if (!saved) return discovered;
  const transports = {};
  for (const { id } of TRANSPORT_PRESENTATION) {
    const current = discovered.transports?.[id] || blankTransport();
    const previous = saved.transports?.[id];
    transports[id] = {
      ...current,
      enabled: previous?.enabled ?? current.enabled ?? false,
      verified: previous?.verified ?? current.verified ?? false,
      config: { ...(current.config || {}), ...(previous?.config || {}) },
    };
  }

  return {
    ...discovered,
    ticketTypes: {
      caisse: false,
      cuisine: false,
      ...(saved.ticketTypes || discovered.ticketTypes || {}),
    },
    transports,
  };
}
