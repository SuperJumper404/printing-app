const {
  validateTerminalConfig,
  validatePaymentRequest,
} = require("./model");
const {
  TERMINAL_STATES,
  createTransactionRegistry,
} = require("./transactions");

function serviceError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

const ERROR_MESSAGES = Object.freeze({
  connection_refused: "Connexion TPE refusee",
  connection_timeout: "Connexion au TPE trop longue",
  serial_port_not_found: "Port serie du TPE introuvable",
  serial_open_failed: "Ouverture du port serie impossible",
  response_timeout: "Reponse du TPE non recue",
  connection_lost: "Communication avec le TPE interrompue",
  protocol_mismatch: "Protocole du TPE incompatible",
});

const RESULT_MESSAGES = Object.freeze({
  ready: "TPE joignable",
  approved: "Paiement accepte",
  declined: "Paiement refuse",
  cancelled: "Paiement annule sur le terminal",
  failed: "Paiement non effectue",
  unknown: "Resultat du paiement inconnu",
});

function safeCode(value) {
  const code = String(value || "");
  return /^[A-Za-z0-9_-]{1,12}$/.test(code) ? code : undefined;
}

function safeAuthorizationReference(value) {
  const reference = String(value || "");
  return /^[A-Za-z0-9_-]{1,12}$/.test(reference) ? reference : undefined;
}

function publicProtocolResult(parsed, transactionId) {
  const result = {
    state: parsed.state,
    message: RESULT_MESSAGES[parsed.state] || "Reponse TPE recue",
  };
  const rawCode = safeCode(parsed.rawCode);
  const authorizationReference = safeAuthorizationReference(
    parsed.authorizationReference,
  );
  if (rawCode) result.rawCode = rawCode;
  if (authorizationReference) {
    result.authorizationReference = authorizationReference;
  }
  if (transactionId && parsed.merchantReference === transactionId) {
    result.merchantReference = transactionId;
  }
  return result;
}

function createTerminalService({ store, protocols, transports, now = Date.now }) {
  const locks = new Set();
  let terminals = (store.get("terminals", []) || [])
    .map((item) => validateTerminalConfig(item))
    .filter((result) => result.ok)
    .map((result) => result.value);
  const registry = createTransactionRegistry({
    initial: store.get("terminalTransactions", []) || [],
    now,
    maxEntries: 100,
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    onChange: (items) => store.set("terminalTransactions", items),
  });

  function persistTerminals() {
    store.set("terminals", terminals);
  }

  function findTerminal(id, { requireEnabled = false } = {}) {
    const terminal = terminals.find((item) => item.id === id);
    if (!terminal || (requireEnabled && !terminal.enabled)) {
      throw serviceError("terminal_not_found", "TPE introuvable ou desactive");
    }
    return terminal;
  }

  function adaptersFor(terminal) {
    const protocol = protocols[terminal.protocol];
    const transport = transports[terminal.transport];
    if (!protocol || !transport) {
      throw serviceError(
        "unsupported_combination",
        "Combinaison protocole et transport non prise en charge",
      );
    }
    return { protocol, transport };
  }

  function transportConfig(terminal) {
    return terminal.transport === "tcp" ? terminal.tcp : terminal.serial;
  }

  function assertTerminalAvailable(terminalId) {
    if (locks.has(terminalId) || registry.hasActiveForTerminal(terminalId)) {
      throw serviceError("terminal_busy", "Une transaction est deja active sur ce TPE");
    }
  }

  function listTerminals() {
    return terminals.map((terminal) => structuredClone(terminal));
  }

  function saveTerminal(input) {
    const validation = validateTerminalConfig(input);
    if (!validation.ok) {
      throw serviceError(validation.code, "Configuration TPE invalide", validation.errors);
    }
    const terminal = validation.value;
    const existingIndex = terminals.findIndex((item) => item.id === terminal.id);
    if (existingIndex >= 0) assertTerminalAvailable(terminal.id);
    if (existingIndex >= 0) terminals.splice(existingIndex, 1, terminal);
    else terminals.push(terminal);
    persistTerminals();
    return structuredClone(terminal);
  }

  function deleteTerminal(id) {
    const existingIndex = terminals.findIndex((item) => item.id === id);
    if (existingIndex < 0) return { success: true };
    assertTerminalAvailable(id);
    terminals.splice(existingIndex, 1);
    persistTerminals();
    return { success: true };
  }

  async function listSerialPorts() {
    if (!transports.serial?.list) return [];
    return transports.serial.list();
  }

  async function testConnection(id) {
    const terminal = findTerminal(id, { requireEnabled: true });
    assertTerminalAvailable(id);
    const { protocol, transport } = adaptersFor(terminal);
    const protocolExchange = protocol.createProbe(terminal);
    locks.add(id);
    try {
      const result = await transport.probe(
        transportConfig(terminal),
        protocolExchange,
      );
      const parsed = publicProtocolResult(
        protocol.parseResponse(result.response, protocolExchange),
      );
      return { success: true, ...parsed };
    } finally {
      locks.delete(id);
    }
  }

  async function processPayment(terminal, request) {
    let requestWritten = false;
    try {
      const { protocol, transport } = adaptersFor(terminal);
      registry.update(request.transactionId, "connecting");
      const protocolExchange = protocol.createPayment(request, terminal);
      registry.update(request.transactionId, "waiting_for_terminal");
      const transportResult = await transport.exchange(
        transportConfig(terminal),
        protocolExchange,
      );
      requestWritten = transportResult.requestWritten === true;
      registry.update(request.transactionId, "authorizing");
      const parsed = publicProtocolResult(
        protocol.parseResponse(transportResult.response, protocolExchange),
        request.transactionId,
      );
      registry.update(request.transactionId, parsed.state, {
        message: parsed.message,
        authorizationReference: parsed.authorizationReference,
        merchantReference: parsed.merchantReference,
        rawCode: parsed.rawCode,
        canCancel: false,
      });
    } catch (error) {
      const current = registry.get(request.transactionId);
      if (current && !TERMINAL_STATES.has(current.state)) {
        const uncertain = requestWritten || error.requestWritten === true;
        registry.update(request.transactionId, uncertain ? "unknown" : "failed", {
          message: uncertain
            ? "Resultat inconnu, consultez le journal du TPE"
            : (ERROR_MESSAGES[error.code] || "Paiement non effectue"),
          rawCode: safeCode(error.code) || "payment_failed",
          canCancel: false,
        });
      }
    } finally {
      locks.delete(terminal.id);
    }
  }

  async function startPayment(input) {
    const validation = validatePaymentRequest(input);
    if (!validation.ok) {
      throw serviceError(validation.code, "Demande de paiement invalide", validation.errors);
    }
    const request = validation.value;
    const existing = registry.get(request.transactionId);
    if (existing) {
      const identical =
        existing.terminalId === request.terminalId &&
        existing.amount === request.amount &&
        existing.currency === request.currency;
      if (!identical) {
        throw serviceError(
          "transaction_conflict",
          "Cet identifiant designe deja un autre paiement",
        );
      }
      return existing;
    }

    const terminal = findTerminal(request.terminalId, { requireEnabled: true });
    assertTerminalAvailable(terminal.id);
    const { protocol } = adaptersFor(terminal);
    const transaction = registry.create({
      ...request,
      state: "queued",
      canCancel: protocol.capabilities(terminal).canCancel === true,
    });
    locks.add(terminal.id);
    Promise.resolve().then(() => processPayment(terminal, request));
    return transaction;
  }

  function getPayment(transactionId) {
    return registry.get(transactionId);
  }

  async function cancelPayment(transactionId) {
    const transaction = registry.get(transactionId);
    if (!transaction) throw serviceError("transaction_not_found", "Transaction inconnue");
    if (TERMINAL_STATES.has(transaction.state)) {
      throw serviceError("cancellation_not_available", "Transaction deja terminee");
    }
    const terminal = findTerminal(transaction.terminalId);
    const { protocol, transport } = adaptersFor(terminal);
    if (!protocol.capabilities(terminal).canCancel) {
      throw serviceError(
        "cancellation_not_supported",
        "Annulation distante non prise en charge par ce TPE",
      );
    }
    const protocolExchange = protocol.createCancellation(transaction, terminal);
    registry.update(transactionId, "cancellation_requested", { canCancel: false });
    const result = await transport.exchange(
      transportConfig(terminal),
      protocolExchange,
    );
    const parsed = publicProtocolResult(
      protocol.parseResponse(result.response, protocolExchange),
      transaction.transactionId,
    );
    return registry.update(transactionId, parsed.state, {
      message: parsed.message,
      rawCode: parsed.rawCode,
      canCancel: false,
    });
  }

  return {
    listTerminals,
    saveTerminal,
    deleteTerminal,
    listSerialPorts,
    testConnection,
    startPayment,
    getPayment,
    cancelPayment,
  };
}

module.exports = { createTerminalService };
