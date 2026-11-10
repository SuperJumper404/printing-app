const { createPrintError, wrapTransportError } = require("../errors");
const DEFAULT_NETWORK_TIMEOUT_MS = 15000;

function createNetworkSender({ createSocket, timeout = DEFAULT_NETWORK_TIMEOUT_MS }) {
  return {
    send({ transport, base64Data, signal }) {
      const config = transport?.config || {};
      if (signal?.aborted) return Promise.reject(createPrintError("ABORTED"));
      if (!config.host) return Promise.reject(createPrintError("CONFIGURATION"));
      const port = Number(config.port) || 9100;
      const configuredTimeout = Number(config.timeoutMs ?? config.timeout ?? timeout);
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_NETWORK_TIMEOUT_MS;
      return new Promise((resolve, reject) => {
        const socket = createSocket();
        let completed = false;
        let writing = false;
        let flushed = false;
        const state = () => writing ? "unknown" : "not-sent";
        const failure = (code) => createPrintError(code, { deliveryState: state(), retryable: !writing && code !== "ABORTED" });
        const cleanup = (closed) => {
          clearTimeout(deadline);
          signal?.removeEventListener("abort", onAbort);
          socket.off("connect", onConnect);
          socket.off("finish", onFinish);
          if (closed) {
            socket.off("close", onClose);
            socket.off("error", onError);
          }
          socket.off("timeout", onTimeout);
          socket.setTimeout(0);
        };
        const finish = (error, closed = false) => {
          if (completed) return;
          completed = true;
          if (error && !closed) socket.destroy();
          cleanup(closed || !error);
          if (error) reject(error); else resolve();
        };
        const onError = (error) => finish(wrapTransportError(error, { deliveryState: state(), fallbackCode: "WRITE_FAILED" }));
        const onTimeout = () => finish(failure("TIMEOUT"));
        const onAbort = () => finish(failure("ABORTED"));
        const onFinish = () => { flushed = true; };
        const onClose = (hadError) => {
          if (completed) { cleanup(true); return; }
          finish(flushed && !hadError ? undefined : failure("CONNECTION_CLOSED"), true);
        };
        const onConnect = () => {
          if (completed) return;
          writing = true;
          try {
            socket.write(Buffer.from(base64Data || "", "base64"), (error) => {
              if (completed) return;
              if (error) { onError(error); return; }
              socket.end();
            });
          } catch (error) { onError(error); }
        };
        const deadline = setTimeout(onTimeout, timeoutMs);
        socket.once("connect", onConnect);
        socket.once("finish", onFinish);
        socket.once("close", onClose);
        socket.on("error", onError);
        socket.once("timeout", onTimeout);
        signal?.addEventListener("abort", onAbort, { once: true });
        socket.setTimeout(timeoutMs);
        try { socket.connect(port, config.host); } catch (error) { onError(error); }
      });
    },
  };
}

module.exports = { createNetworkSender };
