function createIppSender({ createPrinter }) {
  return {
    send({ transport, base64Data }) {
      const config = transport?.config || {};
      const host = config.host;
      if (!host) return Promise.reject(new Error("Adresse IPP manquante"));
      const port = Number(config.port) || 631;
      const path = config.path || "/ipp/print";
      const printer = createPrinter(`http://${host}:${port}${path}`);

      return new Promise((resolve, reject) => {
        printer.execute(
          "Print-Job",
          {
            "operation-attributes-tag": {
              "requesting-user-name": "SmartEat",
              "document-format": "application/octet-stream",
            },
            data: Buffer.from(base64Data, "base64"),
          },
          (error, response) => {
            if (error) return reject(error);
            const status = String(response?.statusCode || "");
            if (status && !/^successful/i.test(status) && !/^2/.test(status)) {
              return reject(new Error(`IPP ${status}`));
            }
            resolve();
          },
        );
      });
    },
  };
}

module.exports = { createIppSender };
