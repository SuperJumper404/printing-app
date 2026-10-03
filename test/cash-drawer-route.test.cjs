const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("HTTP server exposes a cash drawer endpoint", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

  assert.match(source, /dispatchCashDrawerOpen/);
  assert.match(source, /openCashDrawer/);
  assert.match(source, /appServer\.post\("\/cash-drawer\/open"/);
});
