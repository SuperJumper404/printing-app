function chunkGattWrites(bytes, maxChunkSize = 20) {
  const size = Number(maxChunkSize);
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("Taille de fragment GATT invalide");
  }
  const source = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  const chunks = [];
  for (let offset = 0; offset < source.length; offset += size) {
    chunks.push(source.slice(offset, offset + size));
  }
  return chunks;
}

function normalizeGattUuid(value) {
  const uuid = String(value || "").trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(uuid)) {
    return `0000${uuid}-0000-1000-8000-00805f9b34fb`;
  }
  if (/^[0-9a-f]{8}$/.test(uuid)) {
    return `${uuid}-0000-1000-8000-00805f9b34fb`;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
    return uuid;
  }
  throw new Error(`UUID Bluetooth invalide: ${value || "vide"}`);
}

function describeGattAvailability({ detected = false, paired = false } = {}) {
  if (!detected) return { available: false, paired: false, reason: "Bluetooth non detecte" };
  if (!paired) {
    return { available: true, paired: false, reason: "Association Bluetooth requise" };
  }
  return { available: true, paired: true, reason: null };
}

function selectGattWriteMethod(characteristic) {
  if (characteristic?.properties?.writeWithoutResponse) return "writeValueWithoutResponse";
  if (characteristic?.properties?.write) return "writeValueWithResponse";
  throw new Error("Caracteristique Bluetooth sans capacite d'ecriture");
}

async function sendGattChunks(chunks, write, disconnect) {
  try {
    for (const chunk of chunks) await write(chunk);
  } finally {
    await disconnect();
  }
}

module.exports = {
  chunkGattWrites,
  describeGattAvailability,
  normalizeGattUuid,
  selectGattWriteMethod,
  sendGattChunks,
};
