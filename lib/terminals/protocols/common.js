const { encodeTlv, createTlvDecoder } = require("../tlv");

const EXCHANGE_DEFAULTS = Object.freeze({
  connectTimeoutMs: 5000,
  responseTimeoutMs: 180000,
  responseIdleMs: 250,
});

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeVersion(value, fallback) {
  const text = String(value || "").trim();
  if (/^\d{4}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!match) return fallback;
  return `${match[1].padStart(2, "0")}${match[2].padEnd(2, "0")}`;
}

function decodeEntries(buffer) {
  try {
    const decoder = createTlvDecoder();
    decoder.push(buffer);
    const entries = decoder.finish();
    if (!entries.length || entries[0].tag !== "CZ") {
      throw new Error("La version CZ doit etre le premier champ");
    }
    return entries;
  } catch (cause) {
    if (cause.code === "protocol_mismatch") throw cause;
    throw protocolError("protocol_mismatch", "Reponse TPE incompatible");
  }
}

function entriesMap(entries) {
  return Object.fromEntries(entries.map(({ tag, value }) => [tag, value]));
}

function mapPaymentResult(fields) {
  if (fields.AE === "10") {
    return {
      state: "approved",
      message: "Paiement accepte",
      ...(fields.AC ? { authorizationReference: fields.AC } : {}),
      ...(fields.CF ? { merchantReference: fields.CF.split("\u00a7", 1)[0] } : {}),
      rawCode: "10",
    };
  }
  if (fields.AE !== "01") {
    throw protocolError("protocol_mismatch", "Resultat de paiement TPE manquant");
  }

  const rawCode = fields.AF?.slice(0, 2) || "00";
  if (rawCode === "04") {
    return { state: "declined", message: "Paiement refuse", rawCode };
  }
  if (["06", "08"].includes(rawCode)) {
    return {
      state: "cancelled",
      message: "Paiement annule sur le terminal",
      rawCode,
    };
  }
  if (rawCode === "07") {
    return {
      state: "unknown",
      message: "Resultat du paiement inconnu",
      rawCode,
    };
  }
  return { state: "failed", message: "Paiement non effectue", rawCode };
}

function createProtocol({ id, defaultVersion, includeTransactionId }) {
  function baseEntries(config) {
    return [
      ["CZ", normalizeVersion(config.protocolVersion, defaultVersion)],
      ["CJ", config.cashRegisterId],
      ["CA", config.cashRegisterNumber],
    ];
  }

  function exchange(kind, entries, isFinancial) {
    return {
      kind,
      request: encodeTlv(entries),
      isFinancial,
      ...EXCHANGE_DEFAULTS,
      isStructurallyValid(buffer) {
        try {
          const fields = entriesMap(decodeEntries(buffer));
          return kind === "payment" ? Boolean(fields.AE) : Boolean(fields.CZ);
        } catch {
          return false;
        }
      },
    };
  }

  return {
    id,
    capabilities() {
      return { canCancel: false };
    },
    createProbe(config) {
      return exchange("probe", [...baseEntries(config), ["CD", "I"]], false);
    },
    createPayment(request, config) {
      const entries = [
        ...baseEntries(config),
        ["CB", String(request.amount)],
        ["CD", "0"],
        ["CE", "978"],
      ];
      if (includeTransactionId) entries.push(["CF", request.transactionId]);
      if (id === "caisse-ap") entries.push(["BA", "0"]);
      return exchange("payment", entries, true);
    },
    createCancellation() {
      throw protocolError(
        "cancellation_not_supported",
        "Annulation distante non documentee pour ce protocole",
      );
    },
    parseResponse(buffer, currentExchange = {}) {
      const fields = entriesMap(decodeEntries(buffer));
      if (currentExchange.kind === "probe") {
        return { state: "ready", message: "TPE joignable", rawCode: fields.CZ };
      }
      return mapPaymentResult(fields);
    },
  };
}

module.exports = { createProtocol };
