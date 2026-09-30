const CHANNELS = Object.freeze({
  "terminals:list": ["listTerminals", false],
  "terminals:save": ["saveTerminal", true],
  "terminals:delete": ["deleteTerminal", true],
  "terminals:list-serial-ports": ["listSerialPorts", false],
  "terminals:test-connection": ["testConnection", true],
  "terminal-payments:start": ["startPayment", true],
  "terminal-payments:get": ["getPayment", true],
  "terminal-payments:cancel": ["cancelPayment", true],
});

const PUBLIC_ERROR_CODES = new Set([
  "invalid_configuration",
  "invalid_payment_request",
  "terminal_not_found",
  "unsupported_combination",
  "terminal_busy",
  "transaction_conflict",
  "transaction_not_found",
  "cancellation_not_available",
  "cancellation_not_supported",
  "connection_refused",
  "connection_timeout",
  "serial_port_not_found",
  "serial_open_failed",
  "response_timeout",
  "connection_lost",
  "protocol_mismatch",
]);

function publicError(error) {
  if (!PUBLIC_ERROR_CODES.has(error?.code)) {
    return {
      code: "internal_error",
      message: "Erreur interne du module TPE",
    };
  }
  const result = {
    code: error.code,
    message: error.message,
  };
  if (error?.details !== undefined) result.details = error.details;
  return result;
}

function registerTerminalIpc({ ipc, service }) {
  const channels = Object.keys(CHANNELS);

  for (const channel of channels) {
    const [method, acceptsPayload] = CHANNELS[channel];
    ipc.handle(channel, async (_event, payload) => {
      try {
        const value = acceptsPayload
          ? await service[method](payload)
          : await service[method]();
        return { ok: true, value };
      } catch (error) {
        return { ok: false, error: publicError(error) };
      }
    });
  }

  return () => {
    for (const channel of channels) ipc.removeHandler(channel);
  };
}

module.exports = { registerTerminalIpc };
