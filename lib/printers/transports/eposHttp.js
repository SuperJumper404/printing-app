function createEposHttpSender({ fetch }) {
  return {
    async send({ transport, base64Data, xmlData }) {
      const config = transport?.config || {};
      if (!config.host) throw new Error("Adresse ePOS manquante");
      const port = Number(config.port) || 80;
      const deviceId = encodeURIComponent(config.deviceId || "local_printer");
      const timeout = Number(config.timeout) || 6000;
      const scheme = config.secure ? "https" : "http";
      const url = `${scheme}://${config.host}:${port}/cgi-bin/epos/service.cgi?devid=${deviceId}&timeout=${timeout}`;
      const body = xmlData || (() => {
        const hex = Buffer.from(base64Data, "base64").toString("hex");
        return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><command>${hex}</command></epos-print>`;
      })();
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/xml" },
        body,
      });
      if (!response.ok) throw new Error(`HTTP ePOS ${response.status}`);
    },
  };
}

module.exports = { createEposHttpSender };
