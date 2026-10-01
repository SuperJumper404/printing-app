const { TRANSPORT_IDS } = require("./deviceModel");
const { prepareEscPosPayload } = require("./escposCompatibility");
const { resolvePrinterProfile } = require("./printerProfiles");
const {
  renderTicketDataEposXml,
  renderTicketDataEscPos,
  validateTicketData,
} = require("./ticketDataRenderer");

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

function failure(error) {
  return {
    success: false,
    printerCount: 0,
    transportCount: 0,
    protocolCount: 0,
    results: [],
    error,
  };
}

function buildReceivedPayload(attempt, base64Data) {
  return {
    base64Data: prepareEscPosPayload(base64Data, resolvePrinterProfile(attempt.printer)),
  };
}

function buildTicketDataPayload(attempt, ticketData) {
  if (attempt.transportId === "eposHttp") {
    return {
      xmlData: renderTicketDataEposXml(ticketData),
    };
  }

  return {
    base64Data: prepareEscPosPayload(
      renderTicketDataEscPos(ticketData),
      resolvePrinterProfile(attempt.printer),
    ),
  };
}

function buildAttemptPayload(attempt, job, receivedBase64Data) {
  if (attempt.printer.ticketSource === "ticketData") {
    return buildTicketDataPayload(attempt, job.ticketData);
  }
  if (!receivedBase64Data) return null;
  return buildReceivedPayload(attempt, receivedBase64Data);
}

async function runAttempts(attempts, job, senders) {
  if (!attempts.length) return failure("Aucun transport actif pour cette impression");

  const receivedBase64Data = job?.dataFormatESCPOS || job?.base64Data;
  const needsReceivedData = attempts.some(({ printer }) => printer.ticketSource !== "ticketData");
  if (needsReceivedData && !receivedBase64Data) return failure("Donnees ESC/POS manquantes");

  const needsTicketData = attempts.some(({ printer }) => printer.ticketSource === "ticketData");
  if (needsTicketData) {
    const validation = validateTicketData(job?.ticketData);
    if (!validation.valid) return failure(`ticketData invalide: ${validation.error}`);
  }

  const sendableAttempts = attempts
    .map((attempt) => ({
      ...attempt,
      payload: buildAttemptPayload(attempt, job, receivedBase64Data),
    }))
    .filter((attempt) => attempt.payload);

  if (!sendableAttempts.length) return failure("Aucun transport compatible pour cette impression");

  const settled = await Promise.allSettled(
    sendableAttempts.map(({ printer, transportId, transport, payload }) => {
      const sender = senders?.[transportId];
      if (!sender?.send) {
        return Promise.reject(new Error(`Transport non pris en charge: ${transportId}`));
      }
      return sender.send({
        printer,
        transport,
        transportId,
        ...payload,
      });
    }),
  );
  const results = settled.map((result, index) => ({
    printerId: sendableAttempts[index].printer.id,
    transportId: sendableAttempts[index].transportId,
    success: result.status === "fulfilled",
    ...(result.status === "rejected"
      ? { error: result.reason?.message || String(result.reason) }
      : {}),
  }));
  const success = results.some((result) => result.success);
  const printerCount = new Set(sendableAttempts.map(({ printer }) => printer.id)).size;

  return {
    success,
    printerCount,
    transportCount: sendableAttempts.length,
    protocolCount: sendableAttempts.length,
    results,
    ...(success
      ? {}
      : { error: results.map((result) => result.error).filter(Boolean).join("; ") }),
  };
}

async function dispatchEscPosJob(job, printers, senders) {
  return runAttempts(enabledAttempts(printers, job.ticketType), job, senders);
}

async function testPrinterTransports(printer, base64Data, senders) {
  return runAttempts(enabledAttempts([printer]), { dataFormatESCPOS: base64Data }, senders);
}

module.exports = {
  dispatchEscPosJob,
  testPrinterTransports,
};
