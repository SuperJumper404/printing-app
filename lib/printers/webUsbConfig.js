function usbEndpointCandidates(interfaces = []) {
  return interfaces.flatMap((usbInterface) =>
    (usbInterface.alternates || []).flatMap((alternate) =>
      (alternate.endpoints || [])
        .filter((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk")
        .map((endpoint) => ({
          interfaceNumber: usbInterface.interfaceNumber,
          alternateSetting: alternate.alternateSetting ?? 0,
          endpointNumber: endpoint.endpointNumber,
          packetSize: endpoint.packetSize || null,
          interfaceClass: alternate.interfaceClass ?? null,
        })),
    ),
  );
}

function selectUsbBulkOutEndpoint(interfaces, explicit = {}) {
  const candidates = usbEndpointCandidates(interfaces);
  if (explicit.interfaceNumber !== undefined || explicit.endpointNumber !== undefined) {
    return (
      candidates.find(
        (candidate) =>
          (explicit.interfaceNumber === undefined ||
            candidate.interfaceNumber === Number(explicit.interfaceNumber)) &&
          (explicit.alternateSetting === undefined ||
            candidate.alternateSetting === Number(explicit.alternateSetting)) &&
          (explicit.endpointNumber === undefined ||
            candidate.endpointNumber === Number(explicit.endpointNumber)),
      ) || null
    );
  }
  return (
    [...candidates].sort(
      (first, second) =>
        Number(second.interfaceClass === 7) - Number(first.interfaceClass === 7),
    )[0] || null
  );
}

function describeUsbAvailability({ authorized, claimError } = {}) {
  if (!authorized) {
    return { available: false, reason: "Autoriser ce peripherique USB avant l'envoi" };
  }
  if (claimError) {
    return {
      available: false,
      reason: `Interface USB indisponible; elle peut etre utilisee par Windows (${claimError.message})`,
    };
  }
  return { available: true, reason: null };
}

module.exports = {
  describeUsbAvailability,
  selectUsbBulkOutEndpoint,
  usbEndpointCandidates,
};
