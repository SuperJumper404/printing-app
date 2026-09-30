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

function publicError(error) {
  const result = {
    code: error?.code || "internal_error",
    message: error?.code ? error.message : "Erreur interne du module TPE",
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
