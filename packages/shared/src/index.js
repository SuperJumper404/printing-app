export function createPrintPayload({ ticketType, dataFormatESCPOS }) {
  if (!ticketType || typeof ticketType !== "string") {
    throw new Error("ticketType is required");
  }

  if (!dataFormatESCPOS || typeof dataFormatESCPOS !== "string") {
    throw new Error("dataFormatESCPOS is required");
  }

  return {
    ticketType,
    dataFormatESCPOS,
  };
}
