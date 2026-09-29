function chunkHidReports(bytes, reportSize, reportId = 0, options = {}) {
  const size = Number(reportSize);
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("Taille de rapport HID invalide");
  }
  const source = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  const reports = [];
  for (let offset = 0; offset < source.length; offset += size) {
    const slice = source.slice(offset, offset + size);
    const data = options.pad && slice.length < size
      ? Object.assign(new Uint8Array(size), slice)
      : slice;
    reports.push({ reportId: Number(reportId) || 0, data });
  }
  return reports;
}

function describeHidAvailability({ detected = false, authorized = false } = {}) {
  if (!detected) {
    return { available: false, authorized: false, reason: "Peripherique HID non detecte" };
  }
  if (!authorized) {
    return { available: true, authorized: false, reason: "Autorisation HID requise" };
  }
  return { available: true, authorized: true, reason: null };
}

module.exports = {
  chunkHidReports,
  describeHidAvailability,
};
