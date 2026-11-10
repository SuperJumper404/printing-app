const http = require("node:http");
const https = require("node:https");
const ipp = require("ipp");
const { createPrintError, wrapTransportError } = require("../errors");
let nextRequestId = 1;

function hasCompleteAttributes(buffer) {
  let offset = 8;
  let group = false;
  while (offset < buffer.length) {
    const tag = buffer[offset++];
    if (tag === 0x03) return offset === buffer.length;
    if (tag > 0 && tag < 0x10) { group = true; continue; }
    if (!group || tag < 0x10) return false;
    if (tag === 0x7f) offset += 4;
    for (let field = 0; field < 2; field++) {
      if (offset + 2 > buffer.length) return false;
      const length = buffer.readUInt16BE(offset);
      // The installed IPP parser reads lengths as signed 16-bit integers.
      if (length > 0x7fff) return false;
      offset += 2 + length;
      if (offset > buffer.length) return false;
    }
  }
  return false;
}

function createIppSender({ request, serialize = ipp.serialize, parse = ipp.parse } = {}) {
  return {
    async send({ transport, base64Data, signal }) {
      if (signal?.aborted) throw createPrintError("ABORTED");
      const config = transport?.config || {};
      if (!config.host) throw createPrintError("CONFIGURATION");
      const port = Number(config.port) || 631;
      const path = config.path || "/ipp/print";
      const scheme = config.secure ? "https" : "http";
      const id = nextRequestId++;
      if (nextRequestId > 0x7fffffff) nextRequestId = 1;
      const configuredTimeout = Number(config.timeoutMs ?? config.timeout);
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15000;
      let body;
      try {
        body = serialize({
          version: "2.0", operation: "Print-Job", id,
          "operation-attributes-tag": {
            "attributes-charset": "utf-8",
            "attributes-natural-language": "fr",
            "printer-uri": `${config.secure ? "ipps" : "ipp"}://${config.host}:${port}${path}`,
            "requesting-user-name": "SmartEat",
            "document-format": "application/octet-stream",
          },
          data: Buffer.from(base64Data || "", "base64"),
        });
      } catch (error) { throw createPrintError("CONFIGURATION", { cause: error }); }
      return new Promise((resolve, reject) => {
        let req;
        let response;
        let settled = false;
        let writing = false;
        const state = () => writing ? "unknown" : "not-sent";
        const failure = (code) => createPrintError(code, { deliveryState: state(), retryable: !writing && ["TIMEOUT", "CONNECTION_CLOSED"].includes(code) });
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          signal?.removeEventListener("abort", onAbort);
          if (error) { response?.destroy(); req?.destroy(); reject(error); } else resolve(result);
        };
        const onError = (error) => finish(wrapTransportError(error, { deliveryState: state(), fallbackCode: "CONNECTION_FAILED" }));
        const onAbort = () => finish(failure("ABORTED"));
        const deadline = setTimeout(() => finish(failure("TIMEOUT")), timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          req = (request || (config.secure ? https.request : http.request))({
            protocol: `${scheme}:`, hostname: config.host, port, path, method: "POST", agent: false,
            headers: { "Content-Type": "application/ipp", "Content-Length": body.length },
          }, (res) => {
            response = res;
            const chunks = [];
            let length = 0;
            res.on("data", (chunk) => {
              length += chunk.length;
              if (length > 1024 * 1024) { finish(failure("INVALID_RESPONSE")); return; }
              chunks.push(chunk);
            });
            res.once("aborted", () => finish(failure("CONNECTION_CLOSED")));
            res.once("error", onError);
            res.once("end", () => {
              if (settled) return;
              if (res.statusCode !== 200) { finish(failure("PRINTER_REJECTED")); return; }
              const buffer = Buffer.concat(chunks);
              try {
                if (buffer.length < 9 || ![1, 2].includes(buffer[0]) || buffer.readUInt32BE(4) !== id || !hasCompleteAttributes(buffer) || !/^application\/ipp(?:;|$)/i.test(String(res.headers["content-type"] || ""))) {
                  throw new Error("Invalid IPP envelope");
                }
                const result = parse(buffer);
                const status = buffer.readUInt16BE(2);
                if (typeof result.statusCode !== "string" || !result.statusCode) throw new Error("Missing IPP status");
                if (status > 0x00ff || !/^successful-/i.test(result.statusCode)) {
                  const error = failure("PRINTER_REJECTED");
                  error.printerCode = result.statusCode;
                  finish(error); return;
                }
                finish(undefined, result);
              } catch (error) { finish(createPrintError("INVALID_RESPONSE", { cause: error, deliveryState: state() })); }
            });
          });
          req.once("socket", (socket) => {
            if (!socket.connecting) writing = true;
            else socket.once("connect", () => { writing = true; });
          });
          req.once("error", onError);
          req.once("close", () => { if (!settled) finish(failure("CONNECTION_CLOSED")); });
          req.end(body);
        } catch (error) { onError(error); }
      });
    },
  };
}

module.exports = { createIppSender };
