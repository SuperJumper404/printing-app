const { createPrintError, wrapTransportError } = require("../errors");
const sax = require("sax");

function parseEposResponse(xml) {
  const parser = sax.parser(true, { xmlns: true });
  const stack = [];
  let attributes;
  let roots = 0;
  try {
    parser.onerror = (error) => { throw error; };
    parser.ondoctype = () => { throw new Error("Unexpected XML doctype"); };
    parser.onopentag = (tag) => {
      if (!stack.length && ++roots !== 1) throw new Error("Multiple XML roots");
      if (!stack.length && tag.local !== "response" && !(tag.local === "Envelope" && tag.uri === "http://schemas.xmlsoap.org/soap/envelope/")) throw new Error("Unexpected XML root");
      if (tag.local === "response") {
        if (attributes || (tag.uri && tag.uri !== "http://www.epson-pos.com/schemas/2011/03/epos-print")) throw new Error("Unexpected Epson response");
        if (stack.length && !(stack.length === 2 && stack[1].local === "Body" && stack[1].uri === "http://schemas.xmlsoap.org/soap/envelope/")) throw new Error("Response outside SOAP body");
        attributes = Object.fromEntries(Object.entries(tag.attributes).filter(([, attribute]) => !attribute.uri).map(([name, attribute]) => [name, attribute.value]));
      } else if (stack.some((element) => element.local === "response")) throw new Error("Unexpected response content");
      stack.push(tag);
    };
    parser.onclosetag = () => stack.pop();
    parser.ontext = parser.oncdata = (text) => { if (stack.at(-1)?.local === "response" && text.trim()) throw new Error("Unexpected response text"); };
    parser.write(String(xml)).close();
    if (stack.length || !attributes) throw new Error("Missing Epson response");
  } catch (error) { throw createPrintError("INVALID_RESPONSE", { cause: error, deliveryState: "unknown" }); }
  if (!/^(true|false|0|1)$/.test(attributes.success || "") || !/^\d+$/.test(attributes.status || "") || !Object.hasOwn(attributes, "code")) {
    throw createPrintError("INVALID_RESPONSE", { deliveryState: "unknown" });
  }
  const printerStatus = Number(attributes.status);
  if (!Number.isSafeInteger(printerStatus) || printerStatus > 0xffffffff) throw createPrintError("INVALID_RESPONSE", { deliveryState: "unknown" });
  const printerCode = attributes.code;
  if (!["true", "1"].includes(attributes.success) || printerCode) {
    const error = createPrintError("PRINTER_REJECTED", { deliveryState: "unknown" });
    error.printerCode = printerCode;
    error.printerStatus = printerStatus;
    throw error;
  }
  return { printerCode, printerStatus };
}

function createEposHttpSender({ fetch }) {
  return {
    async send({ transport, base64Data, xmlData, signal }) {
      if (signal?.aborted) throw createPrintError("ABORTED");
      const config = transport?.config || {};
      if (!config.host) throw createPrintError("CONFIGURATION");
      const port = Number(config.port) || 80;
      const deviceId = encodeURIComponent(config.deviceId || "local_printer");
      const configuredTimeout = Number(config.timeoutMs ?? config.timeout);
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 6000;
      const scheme = config.secure ? "https" : "http";
      const url = `${scheme}://${config.host}:${port}/cgi-bin/epos/service.cgi?devid=${deviceId}&timeout=${timeoutMs}`;
      const document = xmlData || `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><command>${Buffer.from(base64Data || "", "base64").toString("hex")}</command></epos-print>`;
      // The Epson command element is xs:hexBinary. The web service expects SOAP 1.1.
      const body = /<(?:[\w.-]+:)?Envelope\b/.test(document) ? document
        : `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${document.replace(/^\s*<\?xml[^?]*\?>/, "")}</s:Body></s:Envelope>`;
      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        const response = await fetch(url, {
          method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" },
          body, signal: controller.signal, size: 1024 * 1024, redirect: "error",
        });
        const text = await response.text();
        if (!response.ok) {
          const error = createPrintError("PRINTER_REJECTED", { deliveryState: "unknown" });
          error.httpStatus = response.status;
          throw error;
        }
        return parseEposResponse(text);
      } catch (error) {
        if (controller.signal.aborted) throw createPrintError(timedOut ? "TIMEOUT" : "ABORTED", { cause: error, deliveryState: "unknown" });
        const notSent = ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND"].includes(error?.code);
        throw wrapTransportError(error, { deliveryState: notSent ? "not-sent" : "unknown", fallbackCode: error?.code === "ENOTFOUND" ? "CONFIGURATION" : "CONNECTION_FAILED" });
      } finally {
        clearTimeout(deadline);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

module.exports = { createEposHttpSender };
