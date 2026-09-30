const net = require("net");

function transportError(code, message, requestWritten, cause) {
  const error = new Error(message);
  error.code = code;
  error.requestWritten = requestWritten;
  if (cause) error.cause = cause;
  return error;
}

function createTcpTransport({ createSocket = () => new net.Socket() } = {}) {
  function run(config, protocolExchange) {
    return new Promise((resolve, reject) => {
      const socket = createSocket();
      const chunks = [];
      let settled = false;
      let requestWritten = false;
      let connectTimer;
      let responseTimer;
      let idleTimer;

      const cleanup = () => {
        clearTimeout(connectTimer);
        clearTimeout(responseTimer);
        clearTimeout(idleTimer);
        socket.removeAllListeners();
        socket.destroy();
      };

      const succeed = () => {
        if (settled) return;
        settled = true;
        const response = Buffer.concat(chunks);
        cleanup();
        resolve({ response, requestWritten });
      };

      const fail = (code, message, cause) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(transportError(code, message, requestWritten, cause));
      };

      socket.on("connect", () => {
        clearTimeout(connectTimer);
        try {
          socket.write(protocolExchange.request, (error) => {
            if (error) fail("connection_lost", "Echec d'ecriture vers le TPE", error);
          });
          requestWritten = true;
        } catch (error) {
          fail("connection_lost", "Echec d'ecriture vers le TPE", error);
          return;
        }
        responseTimer = setTimeout(
          () => fail("response_timeout", "Delai de reponse du TPE depasse"),
          protocolExchange.responseTimeoutMs,
        );
      });

      socket.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
        const response = Buffer.concat(chunks);
        clearTimeout(idleTimer);
        if (protocolExchange.isStructurallyValid(response)) {
          idleTimer = setTimeout(succeed, protocolExchange.responseIdleMs);
        }
      });

      socket.on("end", () => {
        if (!chunks.length) {
          fail("connection_lost", "Connexion TPE fermee sans reponse");
        } else if (protocolExchange.isStructurallyValid(Buffer.concat(chunks))) {
          succeed();
        } else {
          fail("protocol_mismatch", "Reponse TPE incomplete");
        }
      });

      socket.on("error", (error) => {
        const refused = /ECONNREFUSED/i.test(`${error.code || ""} ${error.message || ""}`);
        fail(
          refused && !requestWritten ? "connection_refused" : "connection_lost",
          refused ? "Connexion TPE refusee" : "Connexion TPE interrompue",
          error,
        );
      });

      connectTimer = setTimeout(
        () => fail("connection_timeout", "Connexion au TPE trop longue"),
        protocolExchange.connectTimeoutMs,
      );

      try {
        socket.connect(config.port, config.host);
      } catch (error) {
        fail("connection_refused", "Impossible de joindre le TPE", error);
      }
    });
  }

  return {
    probe: run,
    exchange: run,
  };
}

module.exports = { createTcpTransport };
