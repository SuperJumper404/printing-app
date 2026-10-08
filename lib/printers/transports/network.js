const DEFAULT_NETWORK_TIMEOUT_MS = 15000;

function normalizeTimeoutMs(value, fallback = DEFAULT_NETWORK_TIMEOUT_MS) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1000 ? numeric : fallback;
}

function createNetworkSender({ createSocket, timeout = DEFAULT_NETWORK_TIMEOUT_MS }) {
  return {
    send({ transport, base64Data }) {
      const config = transport?.config || {};
      const host = config.host;
      const port = Number(config.port) || 9100;
      const timeoutMs = normalizeTimeoutMs(config.timeoutMs ?? config.timeout, timeout);
      if (!host) return Promise.reject(new Error("Adresse reseau manquante"));

      return new Promise((resolve, reject) => {
        const socket = createSocket();
        let completed = false;
        const finish = (error) => {
          if (completed) return;
          completed = true;
          if (error) {
            socket.destroy();
            reject(error);
          } else {
            resolve();
          }
        };

        socket.setTimeout(timeoutMs);
        socket.once("connect", () => {
          socket.write(Buffer.from(base64Data, "base64"), (error) => {
            if (error) return finish(error);
            socket.end();
            finish();
          });
        });
        socket.once("timeout", () => finish(new Error("Delai reseau depasse")));
        socket.once("error", finish);
        socket.connect(port, host);
      });
    },
  };
}

module.exports = { createNetworkSender };
