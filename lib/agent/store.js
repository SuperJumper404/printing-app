const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function atomicWriteJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function keyParts(key) {
  const parts = String(key).split(".");
  if (parts.some((part) => !part || ["__proto__", "constructor", "prototype"].includes(part))) throw new Error("Clé de configuration invalide");
  return parts;
}

class JsonFileStore {
  constructor({ dataDir, legacyPath } = {}) {
    if (!dataDir) throw new Error("Dossier de configuration requis");
    this.path = path.join(path.resolve(dataDir), "settings.json");
    fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    const exists = fs.existsSync(this.path);
    try {
      this.data = exists ? JSON.parse(fs.readFileSync(this.path, "utf8"))
        : legacyPath && fs.existsSync(legacyPath) ? JSON.parse(fs.readFileSync(legacyPath, "utf8")) : {};
      if (!this.data || Array.isArray(this.data) || typeof this.data !== "object") throw new Error("Invalid object");
    } catch { throw new Error("Configuration machine illisible ; conservez le fichier pour récupération."); }
    if (!exists) atomicWriteJson(this.path, this.data);
  }
  get(key, fallback) {
    let value = this.data;
    for (const part of keyParts(key)) value = value && Object.hasOwn(value, part) ? value[part] : undefined;
    return value === undefined ? fallback : structuredClone(value);
  }
  set(key, value) {
    const updated = structuredClone(this.data);
    const parts = keyParts(key);
    let target = updated;
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== "object" || Array.isArray(target[part])) target[part] = {};
      target = target[part];
    }
    target[parts.at(-1)] = structuredClone(value);
    atomicWriteJson(this.path, updated);
    this.data = updated;
  }
  delete(key) {
    const updated = structuredClone(this.data);
    const parts = keyParts(key);
    let target = updated;
    for (const part of parts.slice(0, -1)) target = target?.[part];
    if (target) delete target[parts.at(-1)];
    atomicWriteJson(this.path, updated);
    this.data = updated;
  }
  clear() { atomicWriteJson(this.path, {}); this.data = {}; }
}

module.exports = { JsonFileStore, atomicWriteJson };
