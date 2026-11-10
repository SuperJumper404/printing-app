const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

function serviceDataDirectory(env = process.env) {
  return env.SMARTEAT_DATA_DIR || path.join(env.ProgramData || "C:\\ProgramData", "SmartEat", "PrinterAgent");
}

function unavailable() {
  return Object.assign(new Error("Le service Windows SmartEat est indisponible. Démarrez le service ou réinstallez l’application."), { code: "SERVICE_UNAVAILABLE" });
}

function createServiceClient({ dataDir = serviceDataDirectory(), request, allowInsecureControlForTests = false } = {}) {
  return {
    async request(action, payload, { signal, timeoutMs = 30000 } = {}) {
      let config;
      try { config = JSON.parse(fs.readFileSync(path.join(dataDir, "connection.json"), "utf8")); }
      catch { throw unavailable(); }
      const token = config.token || config.controlToken;
      if (!Number.isInteger(config.controlPort) || config.controlPort < 1 || config.controlPort > 65535 || !/^[a-f0-9]{64}$/i.test(token || "")) throw unavailable();
      const certificate = config.certificate;
      if (!certificate && !allowInsecureControlForTests) throw unavailable();
      const body = JSON.stringify({ action, payload });
      return new Promise((resolve, reject) => {
        let req;
        let response;
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          signal?.removeEventListener("abort", cancel);
          if (error) { response?.destroy(); req?.destroy(); reject(error); }
          else resolve(value);
        };
        const cancel = () => finish(unavailable());
        const deadline = setTimeout(cancel, Math.max(1, Number(timeoutMs) || 30000));
        if (signal?.aborted) { cancel(); return; }
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          req = (request || (certificate ? https.request : http.request))({ hostname: "127.0.0.1", port: config.controlPort, path: "/control", method: "POST", agent: false,
            ...(certificate ? { ca: certificate, rejectUnauthorized: true, minVersion: "TLSv1.2" } : {}),
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, res => {
            response = res;
            const chunks = []; let length = 0;
            res.on("data", chunk => { length += chunk.length; if (length > 16 * 1024 * 1024) { cancel(); return; } chunks.push(chunk); });
            res.once("error", cancel); res.once("aborted", cancel);
            res.once("end", () => {
              if (settled) return;
              try {
                const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (res.statusCode === 200 && result.ok === true) finish(null, result.value);
                else if (![401, 403].includes(res.statusCode) && result.ok === false && typeof result.error?.message === "string") {
                  finish(Object.assign(new Error(result.error.message.slice(0, 500)), { code: result.error.code || "SERVICE_ERROR" }));
                } else cancel();
              } catch { cancel(); }
            });
          });
          req.once("error", cancel);
          req.end(body);
        } catch { cancel(); }
      });
    },
  };
}

module.exports = { createServiceClient, serviceDataDirectory };
