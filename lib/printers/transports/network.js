function createNetworkSender({ createSocket, timeout = 5000 }) {
  return {
    send({ transport, base64Data }) {
      const config = transport?.config || {};
      const host = config.host;
      const port = Number(config.port) || 9100;
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

        socket.setTimeout(timeout);
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
