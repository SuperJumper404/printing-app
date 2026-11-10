const crypto = require("node:crypto");
const {
  TRANSPORT_IDS,
  createPrinterDevice,
  createTransportState,
} = require("./deviceModel");

function normalized(value) {
  return value === undefined || value === null
    ? ""
    : String(value).trim().toUpperCase();
}

function normalizedPort(value) {
  return normalized(value).replace(/:$/, "");
}

function observationIds(observation) {
  return new Set(
    [observation.observationId, observation.id, ...(observation.instanceIds || [])]
      .map(normalized)
      .filter(Boolean),
  );
}

function parentIds(observation) {
  return new Set((observation.parentInstanceIds || []).map(normalized).filter(Boolean));
}

function intersects(first, second) {
  for (const value of first) {
    if (second.has(value)) return true;
  }
  return false;
}

function hasSameHardwareSerial(first, second) {
  const firstIdentity = [first.vendorId, first.productId, first.serialNumber].map(normalized);
  const secondIdentity = [second.vendorId, second.productId, second.serialNumber].map(normalized);
  return firstIdentity.every(Boolean) && firstIdentity.every((value, index) => value === secondIdentity[index]);
}

function hasParentChildRelationship(first, second) {
  return (
    intersects(observationIds(first), parentIds(second)) ||
    intersects(observationIds(second), parentIds(first))
  );
}

function windowsQueuePort(observation) {
  if (!observation.transports?.windowsRaw?.available) return "";
  return normalizedPort(
    observation.transports.windowsRaw.config?.portName || observation.portName,
  );
}

function serialPort(observation) {
  for (const transportId of ["usbSerial", "bluetoothSerial"]) {
    const transport = observation.transports?.[transportId];
    if (transport?.available) {
      return normalizedPort(transport.config?.portName || observation.portName);
    }
  }
  return "";
}

function hasExactQueuePortRelationship(first, second) {
  const firstQueuePort = windowsQueuePort(first);
  const secondQueuePort = windowsQueuePort(second);
  const firstSerialPort = serialPort(first);
  const secondSerialPort = serialPort(second);
  return Boolean(
    (firstQueuePort && firstQueuePort === secondSerialPort) ||
      (secondQueuePort && secondQueuePort === firstSerialPort),
  );
}

function shouldCorrelate(first, second) {
  const firstContainer = normalized(first.containerId);
  const secondContainer = normalized(second.containerId);
  if (firstContainer && firstContainer === secondContainer) return true;
  if (hasSameHardwareSerial(first, second)) return true;
  if (hasParentChildRelationship(first, second)) return true;
  if (hasExactQueuePortRelationship(first, second)) return true;
  if (first.networkIdentity && normalized(first.networkIdentity) === normalized(second.networkIdentity)) return true;
  const networkSources = new Set(["network", "mdns", "windows-queue"]);
  if (networkSources.has(first.source) && networkSources.has(second.source)) {
    const addresses = new Set([...(first.addresses || []), first.ip].filter(Boolean));
    if ([...(second.addresses || []), second.ip].some((address) => address && addresses.has(address))) return true;
  }
  return false;
}

function mergeConfig(first = {}, second = {}) {
  const merged = { ...first };
  for (const [key, value] of Object.entries(second)) {
    if ((merged[key] === undefined || merged[key] === null || merged[key] === "") && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeTransportStates(observations, transportId) {
  const states = observations
    .map((observation) => observation.transports?.[transportId])
    .filter(Boolean);
  const available = states.some((state) => state.available);
  return createTransportState({
    available,
    enabled: states.some((state) => state.enabled),
    verified: states.some((state) => state.verified),
    candidate: states.some((state) => state.candidate),
    needsAuthorization: states.some((state) => state.needsAuthorization),
    config: states.reduce((config, state) => mergeConfig(config, state.config), {}),
    reason: available
      ? null
      : states.map((state) => state.reason).find(Boolean) || null,
  });
}

function stableDeviceId(observations, association) {
  if (association?.printerId) return String(association.printerId);

  const containerId = observations.map((item) => normalized(item.containerId)).find(Boolean);
  const serialObservation = observations.find(
    (item) => item.vendorId && item.productId && item.serialNumber,
  );
  const networkIdentity = observations.map((item) => normalized(item.networkIdentity)).find(Boolean);
  const source = networkIdentity
    ? `network:${networkIdentity}`
    : containerId
    ? `container:${containerId}`
    : serialObservation
      ? `hardware:${normalized(serialObservation.vendorId)}:${normalized(serialObservation.productId)}:${normalized(serialObservation.serialNumber)}`
      : `observations:${observations
          .flatMap((item) => [...observationIds(item)])
          .sort()
          .join("|")}`;
  const digest = crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
  return `printer-${digest}`;
}

function mergeObservationGroup(observations, association) {
  const sorted = [...observations].sort((first, second) =>
    normalized(first.observationId || first.id).localeCompare(
      normalized(second.observationId || second.id),
    ),
  );
  const transports = {};
  for (const transportId of TRANSPORT_IDS) {
    transports[transportId] = mergeTransportStates(sorted, transportId);
  }

  const firstValue = (key) => sorted.map((item) => item[key]).find(Boolean) || null;
  const unique = (values) => [...new Set(values.filter(Boolean).map(String))];

  return createPrinterDevice({
    id: stableDeviceId(sorted, association),
    name: firstValue("name") || "Imprimante",
    favorite: sorted.some((item) => item.favorite),
    manufacturer: firstValue("manufacturer"),
    vendorId: firstValue("vendorId"),
    productId: firstValue("productId"),
    serialNumber: firstValue("serialNumber"),
    containerId: firstValue("containerId"),
    networkIdentity: firstValue("networkIdentity"),
    instanceIds: unique(sorted.flatMap((item) => item.instanceIds || [])),
    parentInstanceIds: unique(sorted.flatMap((item) => item.parentInstanceIds || [])),
    addresses: unique(sorted.flatMap((item) => [...(item.addresses || []), item.ip])),
    ticketTypes: {
      caisse: sorted.some((item) => item.ticketTypes?.caisse),
      cuisine: sorted.some((item) => item.ticketTypes?.cuisine),
    },
    escposVerifiedTransports: unique(
      sorted.flatMap((item) => item.escposVerifiedTransports || []),
    ),
    transports,
    observations: sorted,
  });
}

function correlatePrinterObservations(observations = [], savedAssociations = []) {
  if (!Array.isArray(observations) || observations.length === 0) return [];

  const parents = observations.map((_, index) => index);
  const find = (index) => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const union = (first, second) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };

  for (let first = 0; first < observations.length; first += 1) {
    for (let second = first + 1; second < observations.length; second += 1) {
      if (shouldCorrelate(observations[first], observations[second])) union(first, second);
    }
  }

  for (const association of savedAssociations || []) {
    const associatedIds = new Set((association.observationIds || []).map(normalized));
    const indexes = observations
      .map((item, index) => (intersects(observationIds(item), associatedIds) ? index : -1))
      .filter((index) => index >= 0);
    const networkIdentities = (index) => new Set(observations
      .filter((_, candidate) => find(candidate) === find(index))
      .map((observation) => normalized(observation.networkIdentity)).filter(Boolean));
    const strongIndexes = indexes.filter((index) => [...observationIds(observations[index])]
      .some((id) => associatedIds.has(id) && !/^NETWORK:\d+\.\d+\.\d+\.\d+$/i.test(id)));
    const anchoredRoots = new Set(strongIndexes.filter((index) => networkIdentities(index).size).map(find));
    const eligible = indexes.filter((index) => !anchoredRoots.size || strongIndexes.includes(index) || anchoredRoots.has(find(index)));
    for (let index = 1; index < eligible.length; index += 1) {
      const firstIdentities = networkIdentities(eligible[0]);
      const secondIdentities = networkIdentities(eligible[index]);
      // Saved addresses are historical evidence; never bridge distinct currently observed mDNS groups.
      if (firstIdentities.size && secondIdentities.size && !intersects(firstIdentities, secondIdentities)) continue;
      union(eligible[0], eligible[index]);
    }
  }

  const groups = new Map();
  observations.forEach((observation, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(observation);
  });

  return [...groups.values()]
    .map((group) => {
      const groupIds = new Set(group.flatMap((item) => [...observationIds(item)]));
      const association = (savedAssociations || []).find((item) => {
        const matchingIds = (item.observationIds || []).filter((id) => groupIds.has(normalized(id)));
        if (matchingIds.length === 0) return false;
        // An IP can be reassigned. A known mDNS identity requires more than the old IP.
        if (group.some((observation) => observation.networkIdentity)) {
          return matchingIds.some((id) => !/^NETWORK:\d+\.\d+\.\d+\.\d+$/i.test(id));
        }
        return true;
      });
      return mergeObservationGroup(group, association);
    })
    .sort((first, second) => first.id.localeCompare(second.id));
}

module.exports = {
  correlatePrinterObservations,
};
