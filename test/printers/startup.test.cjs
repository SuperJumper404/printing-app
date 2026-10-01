const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  configureAutoLaunch,
  runStartupPrinterTests,
  scheduleStartupPrinterTests,
} = require("../../lib/printers/startup");

function printer(id, enabled) {
  return {
    id,
    name: id,
    transports: {
      windowsRaw: { enabled, config: { printerName: id } },
    },
  };
}

test("configures Windows login launch with a visible window", () => {
  const calls = [];
  const app = {
    getPath: (name) => name === "exe" ? "C:\\SmartEat\\SmartEat.exe" : null,
    setLoginItemSettings: (settings) => calls.push(settings),
  };

  configureAutoLaunch(app, "win32");

  assert.deepEqual(calls, [{
    openAtLogin: true,
    path: "C:\\SmartEat\\SmartEat.exe",
    args: [],
  }]);
});

test("prints once for every saved printer with an enabled transport", async () => {
  const calls = [];
  const result = await runStartupPrinterTests({
    printers: [printer("counter", true), printer("disabled", false), printer("kitchen", true)],
    buildTestPayload: (printer) => `payload:${printer.name}`,
    testPrinterTransports: async (item, payload) => {
      calls.push([item.id, payload]);
      if (item.id === "counter") throw new Error("offline");
      return { success: true };
    },
    senders: { windowsRaw: {} },
  });

  assert.deepEqual(calls, [
    ["counter", "payload:counter"],
    ["kitchen", "payload:kitchen"],
  ]);
  assert.deepEqual(result.map((item) => [item.printerId, item.success]), [
    ["counter", false],
    ["kitchen", true],
  ]);
});

test("runs the startup print only once after the renderer is loaded", async () => {
  const webContents = new EventEmitter();
  let calls = 0;
  scheduleStartupPrinterTests(webContents, async () => { calls += 1; });

  webContents.emit("did-finish-load");
  webContents.emit("did-finish-load");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls, 1);
});
