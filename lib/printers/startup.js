function configureAutoLaunch(app, platform = process.platform) {
  if (platform !== "win32") return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath("exe"),
    args: [],
  });
}

function hasEnabledTransport(printer) {
  return Object.values(printer?.transports || {}).some(
    (transport) => transport?.enabled === true,
  );
}

async function runStartupPrinterTests({
  printers,
  buildTestPayload,
  testPrinterTransports,
  senders,
}) {
  const activePrinters = (printers || []).filter(hasEnabledTransport);
  const settled = await Promise.allSettled(
    activePrinters.map((printer) => testPrinterTransports(
      printer,
      buildTestPayload(printer),
      senders,
    )),
  );

  return settled.map((item, index) => ({
    printerId: activePrinters[index].id,
    success: item.status === "fulfilled" && item.value?.success === true,
    ...(item.status === "fulfilled"
      ? { result: item.value }
      : { error: item.reason?.message || String(item.reason) }),
  }));
}

function scheduleStartupPrinterTests(webContents, run, onError = console.error) {
  webContents.once("did-finish-load", () => {
    Promise.resolve().then(run).catch(onError);
  });
}

module.exports = {
  configureAutoLaunch,
  runStartupPrinterTests,
  scheduleStartupPrinterTests,
};
