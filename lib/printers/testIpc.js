const { formatPrintError } = require("./errors");

function registerPrinterTestIpc({ ipc, getPrinters, migratePrinters, testPrinterTransports, buildPayload, senders, label }) {
  async function run(config = {}) {
    const printers = migratePrinters(getPrinters());
    const printer = config.transports ? migratePrinters([config])[0]
      : printers.find(printer => (config.id && printer.id === config.id) || (config.ip && (printer.ip === config.ip || printer.addresses?.includes(config.ip))));
    if (!printer) return { success: false, message: "Imprimante introuvable dans la configuration" };
    try {
      const result = await testPrinterTransports(printer, buildPayload(printer), senders);
      return { ...result, message: result.results?.length
        ? result.results.map(item => `${label(item.transportId)} : ${item.success ? "Transmis" : item.error}`).join("\n")
        : result.error };
    } catch (error) { return { success: false, message: formatPrintError(error) }; }
  }
  ipc.handle("test-printer-protocols", (_, config) => run(config));
  ipc.on("test-printer", async (event, config) => event.reply("test-printer-response", await run(config)));
}

module.exports = { registerPrinterTestIpc };
