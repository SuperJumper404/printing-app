const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "../..");
const packageJson = require("../../package.json");

test("packages the serialport N-API prebuild without a local C++ rebuild", () => {
  assert.equal(packageJson.build.npmRebuild, false);
  assert.equal(typeof packageJson.dependencies.serialport, "string");
  assert.equal(
    fs.existsSync(path.join(
      projectRoot,
      "node_modules",
      "@serialport",
      "bindings-cpp",
      "prebuilds",
      "win32-x64",
      "@serialport+bindings-cpp.node",
    )),
    true,
  );
});
