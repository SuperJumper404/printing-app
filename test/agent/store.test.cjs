const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let JsonFileStore;
try { ({ JsonFileStore } = require("../../lib/agent/store")); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "smarteat-store-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("machine settings survive a new store instance and support nested session fields", (t) => {
  assert.equal(typeof JsonFileStore, "function");
  const dataDir = temporary(t);
  const first = new JsonFileStore({ dataDir });
  first.set("userSession", { token: "synthetic-test-token", shopid: 12 });
  first.set("printers", [{ id: "favorite", favorite: true }]);
  const second = new JsonFileStore({ dataDir });
  assert.equal(second.get("userSession.token"), "synthetic-test-token");
  assert.equal(second.get("printers")[0].favorite, true);
  const session = second.get("userSession");
  session.shopid = 99;
  assert.equal(second.get("userSession.shopid"), 12);
  assert.deepEqual(fs.readdirSync(dataDir), ["settings.json"]);
});

test("explicit legacy import happens only when machine settings do not exist", (t) => {
  assert.equal(typeof JsonFileStore, "function");
  const root = temporary(t);
  const legacyPath = path.join(root, "synthetic-legacy.json");
  fs.writeFileSync(legacyPath, JSON.stringify({ printers: [{ id: "imported" }] }));
  const dataDir = path.join(root, "machine");
  const first = new JsonFileStore({ dataDir, legacyPath });
  assert.equal(first.get("printers")[0].id, "imported");
  first.set("printers", [{ id: "changed" }]);
  fs.writeFileSync(legacyPath, "invalid legacy content");
  assert.equal(new JsonFileStore({ dataDir, legacyPath }).get("printers")[0].id, "changed");
});

test("a corrupt machine configuration fails visibly instead of replacing settings", (t) => {
  assert.equal(typeof JsonFileStore, "function");
  const dataDir = temporary(t);
  fs.writeFileSync(path.join(dataDir, "settings.json"), "{invalid");
  assert.throws(() => new JsonFileStore({ dataDir }), /configuration/i);
  assert.equal(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"), "{invalid");
});
