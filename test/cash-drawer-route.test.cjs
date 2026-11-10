const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentRuntime } = require("../lib/agent/runtime");

test("HTTP service routes the cash drawer endpoint through the configured printer", async t => {
  const data = { printers: [{ id: "counter", printerConfigVersion: 2, encoding: "raw", ticketTypes: { caisse: true }, transports: { windowsRaw: { enabled: true, available: true, config: { printerName: "Test" } } } }] };
  const store = { get: (key, fallback) => data[key] ?? fallback, set: (key, value) => { data[key] = value; }, delete: key => { delete data[key]; } };
  let pulse;
  const runtime = createAgentRuntime({ store, controlToken: "a".repeat(64), publicPort: 0, controlPort: 0, discoveryIntervalMs: 0, allowInsecureControlForTests: true,
    senders: { windowsRaw: { send: async ({ base64Data }) => { pulse = base64Data; } } } });
  t.after(() => runtime.stop());
  await runtime.start();
  const response = await fetch(`http://127.0.0.1:${runtime.status().publicPort}/cash-drawer/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(pulse, "G3AAGfo=");
});
