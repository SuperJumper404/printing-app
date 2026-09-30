const PROTOCOL_IDS = Object.freeze(["caisse-ap", "nepting"]);
const TRANSPORT_IDS = Object.freeze(["tcp", "serial"]);

const PAYMENT_KEYS = new Set([
  "transactionId",
  "terminalId",
  "amount",
  "currency",
]);
const FULLY_REDACTED_KEYS = /token|password|secret|authorizationReference|rawFrame|receipt|pan|pin|track|cryptogram/i;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeTerminalConfig(input = {}) {
  const protocol = cleanString(input.protocol).toLowerCase();
  const transport = cleanString(input.transport).toLowerCase();
  const serialPath = cleanString(input.serial?.path)
    .replace(/:$/, "")
    .toUpperCase();

  return {
    id: cleanString(input.id),
    name: cleanString(input.name),
    manufacturer: cleanString(input.manufacturer),
    model: cleanString(input.model),
    enabled: input.enabled !== false,
    protocol,
    protocolVersion:
      cleanString(input.protocolVersion) ||
      (protocol === "nepting" ? "0320" : "0300"),
    transport,
    cashRegisterId: cleanString(input.cashRegisterId),
    cashRegisterNumber: cleanString(input.cashRegisterNumber) || "01",
    tcp: {
      host: cleanString(input.tcp?.host),
      port: cleanInteger(input.tcp?.port, 8888),
    },
    serial: {
      path: serialPath,
      baudRate: cleanInteger(input.serial?.baudRate, 115200),
      dataBits: cleanInteger(input.serial?.dataBits, 8),
      parity: cleanString(input.serial?.parity).toLowerCase() || "none",
      stopBits: cleanInteger(input.serial?.stopBits, 1),
      flowControl:
        cleanString(input.serial?.flowControl).toLowerCase() || "none",
    },
    nepting: {
      merchantId: cleanString(input.nepting?.merchantId),
    },
  };
}

function validateTerminalConfig(input) {
  const value = normalizeTerminalConfig(input);
  const errors = [];

  if (!value.id) errors.push("Identifiant du TPE manquant");
  if (!value.name) errors.push("Nom du TPE manquant");
  if (!PROTOCOL_IDS.includes(value.protocol)) {
    errors.push("Protocole TPE non pris en charge");
  }
  if (!TRANSPORT_IDS.includes(value.transport)) {
    errors.push("Transport TPE non pris en charge");
  }

  if (value.transport === "tcp") {
    if (!value.tcp.host) errors.push("Adresse TCP du TPE manquante");
    if (value.tcp.port < 1 || value.tcp.port > 65535) {
      errors.push("Port TCP du TPE invalide");
    }
  }

  if (value.transport === "serial") {
    if (!/^COM\d+$/i.test(value.serial.path)) {
      errors.push("Port COM du TPE invalide");
    }
    if (value.serial.baudRate <= 0) {
      errors.push("Vitesse serie du TPE invalide");
    }
    if (![7, 8].includes(value.serial.dataBits)) {
      errors.push("Nombre de bits serie invalide");
    }
    if (![1, 2].includes(value.serial.stopBits)) {
      errors.push("Nombre de bits d'arret invalide");
    }
    if (!["none", "even", "odd", "mark", "space"].includes(value.serial.parity)) {
      errors.push("Parite serie invalide");
    }
  }

  if (!/^[A-Za-z0-9]{12}$/.test(value.cashRegisterId)) {
    errors.push("Identifiant caisse invalide");
  }
  if (!/^\d{2}$/.test(value.cashRegisterNumber)) {
    errors.push("Numero de caisse invalide");
  }

  return errors.length
    ? { ok: false, code: "invalid_configuration", errors }
    : { ok: true, value };
}

function validatePaymentRequest(input) {
  const source = input && typeof input === "object" ? input : {};
  const unknownKeys = Object.keys(source).filter((key) => !PAYMENT_KEYS.has(key));
  const value = {
    transactionId: cleanString(source.transactionId),
    terminalId: cleanString(source.terminalId),
    amount: source.amount,
    currency: cleanString(source.currency).toUpperCase(),
  };
  const errors = [];

  if (unknownKeys.length) errors.push("Champs de paiement non autorises");
  if (!value.transactionId) errors.push("Identifiant de transaction manquant");
  if (!value.terminalId) errors.push("Identifiant du TPE manquant");
  if (!Number.isSafeInteger(value.amount) || value.amount <= 0) {
    errors.push("Montant invalide");
  }
  if (value.currency !== "EUR") errors.push("Devise non prise en charge");

  return errors.length
    ? { ok: false, code: "invalid_payment_request", errors }
    : { ok: true, value };
}

function maskMerchantId(value) {
  const text = String(value || "");
  if (text.length <= 4) return "[REDACTED]";
  return `${"*".repeat(text.length - 4)}${text.slice(-4)}`;
}

function redactTerminalValue(value, key = "") {
  if (/merchantId/i.test(key)) return maskMerchantId(value);
  if (FULLY_REDACTED_KEYS.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((item) => redactTerminalValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactTerminalValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

module.exports = {
  PROTOCOL_IDS,
  TRANSPORT_IDS,
  normalizeTerminalConfig,
  validateTerminalConfig,
  validatePaymentRequest,
  redactTerminalValue,
};
