function normalizePath(value) {
  return String(value || "").trim().replace(/:$/, "").toUpperCase();
}

function transportError(code, message, requestWritten, cause) {
  const error = new Error(message);
  error.code = code;
  error.requestWritten = requestWritten;
  if (cause) error.cause = cause;
  return error;
}

function createSerialTransport(options = {}) {
  const serialport = options.SerialPortClass ? null : require("serialport");
  const SerialPortClass = options.SerialPortClass || serialport.SerialPort;
  const listPorts = options.listPorts || (() => SerialPortClass.list());

  async function list() {
    const ports = await listPorts();
    return (ports || []).map((port) => ({
      path: normalizePath(port.path),
      manufacturer: port.manufacturer || null,
      serialNumber: port.serialNumber || null,
      vendorId: port.vendorId || null,
      productId: port.productId || null,
    }));
  }

  async function run(config, protocolExchange) {
    const path = normalizePath(config.path);
    const available = await list();
    if (!available.some((port) => port.path === path)) {
      throw transportError(
        "serial_port_not_found",
        `Port serie introuvable: ${path}`,
        false,
      );
    }

    return new Promise((resolve, reject) => {
      const port = new SerialPortClass({
        path,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        parity: config.parity,
        stopBits: config.stopBits,
        rtscts: ["rts", "rtscts"].includes(config.flowControl),
        xon: ["xon", "xon/xoff"].includes(config.flowControl),
        xoff: ["xoff", "xon/xoff"].includes(config.flowControl),
        autoOpen: false,
      });
      const chunks = [];
      let settled = false;
      let requestWritten = false;
      let openTimer;
      let responseTimer;
      let idleTimer;

      const cleanup = () => {
        clearTimeout(openTimer);
        clearTimeout(responseTimer);
        clearTimeout(idleTimer);
        port.removeAllListeners();
        if (port.isOpen) port.close(() => {});
        if (typeof port.destroy === "function") port.destroy();
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

      port.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
        const response = Buffer.concat(chunks);
        clearTimeout(idleTimer);
        if (protocolExchange.isStructurallyValid(response)) {
          idleTimer = setTimeout(succeed, protocolExchange.responseIdleMs);
        }
      });
      port.on("error", (error) => {
        fail(
          requestWritten ? "connection_lost" : "serial_open_failed",
          requestWritten
            ? "Communication serie avec le TPE interrompue"
            : "Ouverture du port serie impossible",
          error,
        );
      });

      openTimer = setTimeout(
        () => fail("connection_timeout", "Ouverture du port serie trop longue"),
        protocolExchange.connectTimeoutMs,
      );
      port.open((openError) => {
        if (settled) return;
        clearTimeout(openTimer);
        if (openError) {
          fail("serial_open_failed", "Ouverture du port serie impossible", openError);
          return;
        }
        try {
          requestWritten = true;
          port.write(protocolExchange.request, (writeError) => {
            if (writeError) {
              fail("connection_lost", "Echec d'ecriture vers le TPE", writeError);
            }
          });
        } catch (error) {
          fail("connection_lost", "Echec d'ecriture vers le TPE", error);
          return;
        }
        responseTimer = setTimeout(
          () => fail("response_timeout", "Delai de reponse du TPE depasse"),
          protocolExchange.responseTimeoutMs,
        );
      });
    });
  }

  return { list, probe: run, exchange: run };
}

module.exports = { createSerialTransport };
