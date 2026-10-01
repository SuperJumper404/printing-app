const { TRANSPORT_IDS } = require("./deviceModel");
const { prepareEscPosPayload } = require("./escposCompatibility");
const { resolvePrinterProfile } = require("./printerProfiles");

function enabledAttempts(printers, ticketType) {
  const attempts = [];
  for (const printer of printers || []) {
    if (ticketType && !printer.ticketTypes?.[ticketType]) continue;
    for (const transportId of TRANSPORT_IDS) {
      const transport = printer.transports?.[transportId];
      if (transport?.enabled) attempts.push({ printer, transportId, transport });
    }
  }
  return attempts;
}

async function runAttempts(attempts, base64Data, senders) {
  if (!attempts.length) {
    return {
      success: false,
      printerCount: 0,
      transportCount: 0,
      protocolCount: 0,
      results: [],
      error: "Aucun transport actif pour cette impression",
    };
  }

  const settled = await Promise.allSettled(
    attempts.map(({ printer, transportId, transport }) => {
      const sender = senders?.[transportId];
      if (!sender?.send) {
        return Promise.reject(new Error(`Transport non pris en charge: ${transportId}`));
      }
      return sender.send({
        printer,
        transport,
        transportId,
        base64Data: prepareEscPosPayload(base64Data, resolvePrinterProfile(printer)),
      });
    }),
  );
  const results = settled.map((result, index) => ({
    printerId: attempts[index].printer.id,
    transportId: attempts[index].transportId,
    success: result.status === "fulfilled",
    ...(result.status === "rejected"
      ? { error: result.reason?.message || String(result.reason) }
      : {}),
  }));
  const success = results.some((result) => result.success);
  const printerCount = new Set(attempts.map(({ printer }) => printer.id)).size;

  return {
    success,
    printerCount,
    transportCount: attempts.length,
    protocolCount: attempts.length,
    results,
    ...(success
      ? {}
      : { error: results.map((result) => result.error).filter(Boolean).join("; ") }),
  };
}

async function dispatchEscPosJob(job, printers, senders) {
  const base64Data = job?.dataFormatESCPOS || job?.base64Data;
  if (!base64Data) {
    return {
      success: false,
      printerCount: 0,
      transportCount: 0,
      protocolCount: 0,
      results: [],
      error: "Donnees ESC/POS manquantes",
    };
  }
  return runAttempts(enabledAttempts(printers, job.ticketType), base64Data, senders);
}

async function testPrinterTransports(printer, base64Data, senders) {
  return runAttempts(enabledAttempts([printer]), base64Data, senders);
}

module.exports = {
  dispatchEscPosJob,
  testPrinterTransports,
};
