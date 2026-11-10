const net = require("node:net");
const os = require("node:os");
const { setMaxListeners } = require("node:events");

const PORT_TRANSPORTS = { 9100: "network9100", 631: "ipp", 515: "lpr", 80: "eposHttp" };

function ipv4Number(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split(".").reduce((result, part) => (result * 256) + Number(part), 0) >>> 0;
}

function ipv4String(value) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function usableAddress(address) {
  const value = ipv4Number(address);
  return value !== null && value > 0 && (value >>> 24) !== 127 && (value >>> 24) < 224;
}

function collectNetworkTargets(interfaces = {}, { maxHosts = 512, knownHosts = [], cursor = 0 } = {}) {
  const limit = Math.max(1, Math.min(4096, Number(maxHosts) || 512));
  const ownAddresses = new Set();
  const subnets = [];
  const neighborhoods = [];
  const seenSubnets = new Set();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.internal || !["IPv4", 4].includes(entry.family) || !usableAddress(entry.address)) continue;
      const address = ipv4Number(entry.address);
      const mask = ipv4Number(entry.netmask);
      if (mask === null) continue;
      const wildcard = (~mask) >>> 0;
      if ((wildcard & (wildcard + 1)) !== 0) continue;
      const network = (address & mask) >>> 0;
      ownAddresses.add(entry.address);
      // /31 is a point-to-point link; /32 has no neighbour to scan.
      if (wildcard === 0) continue;
      const start = wildcard === 1 ? network : network + 1;
      const count = wildcard === 1 ? 2 : wildcard - 1;
      const neighborhoodStart = Math.max(start, (address & 0xffffff00) >>> 0);
      const neighborhoodEnd = Math.min(start + count - 1, (((address & 0xffffff00) >>> 0) + 255));
      neighborhoods.push({ start: neighborhoodStart, count: neighborhoodEnd - neighborhoodStart + 1 });
      const key = `${start}/${count}`;
      if (!seenSubnets.has(key)) {
        seenSubnets.add(key);
        subnets.push({ start, count });
      }
    }
  }
  const targets = new Set();
  for (const host of knownHosts) {
    if (usableAddress(host) && !ownAddresses.has(host)) targets.add(host);
    if (targets.size >= limit) return [...targets];
  }
  const scanBudget = limit - targets.size;
  const share = Math.max(1, Math.floor(scanBudget / Math.max(1, subnets.length)));
  // Spend half the bounded scan near each interface; rotate the rest through its real subnet.
  const localLimit = targets.size + Math.floor(scanBudget / 2);
  const localShare = Math.max(1, Math.floor(scanBudget / 2 / Math.max(1, neighborhoods.length)));
  const localVisited = neighborhoods.map(() => 0);
  while (targets.size < localLimit) {
    let progressed = false;
    for (let index = 0; index < neighborhoods.length && targets.size < localLimit; index += 1) {
      const neighborhood = neighborhoods[index];
      if (localVisited[index] >= neighborhood.count) continue;
      const offset = ((Math.max(0, Number(cursor) || 0) * localShare) + localVisited[index]) % neighborhood.count;
      const host = ipv4String(neighborhood.start + offset);
      localVisited[index] += 1;
      progressed = true;
      if (!ownAddresses.has(host)) targets.add(host);
    }
    if (!progressed) break;
  }
  const offsets = subnets.map((subnet) => ((Math.max(0, Number(cursor) || 0) * share) % subnet.count));
  const visited = subnets.map(() => 0);
  while (targets.size < limit) {
    let progressed = false;
    for (let index = 0; index < subnets.length && targets.size < limit; index += 1) {
      const subnet = subnets[index];
      if (visited[index] >= subnet.count) continue;
      const host = ipv4String(subnet.start + ((offsets[index] + visited[index]) % subnet.count));
      visited[index] += 1;
      progressed = true;
      if (!ownAddresses.has(host)) targets.add(host);
    }
    if (!progressed) break;
  }
  return [...targets];
}

function probeTcpPort(host, port, { signal, timeoutMs = 250 } = {}) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (online) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", aborted);
      socket.destroy();
      resolve(online);
    };
    const aborted = () => finish(false);
    signal?.addEventListener("abort", aborted, { once: true });
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.connect(port, host);
  });
}

function transportState(host, port, extra = {}) {
  return {
    available: true, enabled: false, verified: false, reason: null,
    config: { host, port, ...(port === 9100 ? { timeoutMs: 15000 } : {}), ...extra },
  };
}

async function discoverNetworkPrinterObservations({
  networkInterfaces = os.networkInterfaces(), bonjour, knownHosts = [], knownEposHosts = [], timeoutMs = 8000,
  maxHosts = 512, concurrency = 48, cursor = 0, probe = probeTcpPort, signal,
} = {}) {
  const deadline = Math.max(1, Math.min(30000, Number(timeoutMs) || 8000));
  const controller = new AbortController();
  setMaxListeners(132, controller.signal);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const found = new Map();
  const eposHosts = new Set(knownEposHosts.filter(usableAddress));
  const tasks = [];
  const advertisedTasks = [];
  const taskKeys = new Set();
  const browsers = [];
  let nextTask = 0;
  const waiters = new Set();
  let finished = false;
  const notify = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  controller.signal.addEventListener("abort", notify);
  const timer = setTimeout(abort, deadline);
  const addTask = (task) => {
    const key = `${task.identity || ""}|${task.host}|${task.port}|${task.transportId}`;
    if (taskKeys.has(key)) return;
    taskKeys.add(key);
    if (task.identity) advertisedTasks.push(task);
    else tasks.push(task);
    notify();
  };
  const mdns = (service) => {
    if (finished || controller.signal.aborted) return;
    const type = String(service.type || "").replace(/^_/, "").toLowerCase();
    const transportId = ({ ipp: "ipp", ipps: "ipp", printer: "lpr", "pdl-datastream": "network9100" })[type];
    if (!transportId || !Number.isInteger(Number(service.port)) || service.port < 1 || service.port > 65535) return;
    const host = (service.addresses || []).find(usableAddress);
    if (!host) return;
    const identity = service.fqdn || `${service.name}._${type}._tcp.local`;
    const path = service.txt?.rp ? `/${String(service.txt.rp).replace(/^\/+/, "")}` : undefined;
    addTask({ host, port: Number(service.port), transportId,
      identity, name: service.name || host,
      extra: { ...(path && transportId === "ipp" ? { path } : {}), ...(type === "ipps" ? { secure: true } : {}) },
    });
  };
  try {
    if (bonjour?.find && !controller.signal.aborted) {
      try { browsers.push(bonjour.find({}, mdns)); } catch { /* TCP discovery remains usable without mDNS. */ }
    }
    for (const host of collectNetworkTargets(networkInterfaces, { maxHosts, knownHosts, cursor })) {
      for (const [port, transportId] of Object.entries(PORT_TRANSPORTS)) addTask({ host, port: Number(port), transportId });
    }
    const workerCount = Math.max(1, Math.min(128, Number(concurrency) || 48));
    const probeTimeoutMs = Math.min(250, Math.max(25, Math.floor(deadline * 0.7 * workerCount / Math.max(1, tasks.length + advertisedTasks.length))));
    const worker = async () => {
      while (!controller.signal.aborted) {
        const task = advertisedTasks.shift() || tasks[nextTask++];
        if (!task) {
          nextTask -= 1;
          if (!bonjour?.find) break;
          await new Promise((resolve) => { waiters.add(resolve); });
          continue;
        }
        let online = false;
        try {
          online = await probe(task.host, task.port, { signal: controller.signal, timeoutMs: probeTimeoutMs });
        } catch { /* A failed probe is not an observed printer service. */ }
        if (!online || controller.signal.aborted) continue;
        const key = task.identity ? `mdns:${task.identity}` : `network:${task.host}`;
        if (!found.has(key)) found.set(key, {
          id: key, observationId: key, source: task.identity ? "mdns" : "network",
          ...(task.identity ? { networkIdentity: task.identity } : {}),
          name: task.name || `Imprimante ${task.host}`, ip: task.host, addresses: [task.host], transports: {},
        });
        const transport = transportState(task.host, task.port, task.extra);
        if (task.transportId === "eposHttp" && !eposHosts.has(task.host)) {
          transport.available = false;
          transport.candidate = true;
          transport.reason = "Service HTTP détecté ; compatibilité Epson ePOS à confirmer avec l'adresse IP et le port 80";
        }
        found.get(key).transports[task.transportId] = transport;
      }
    };
    const scans = Promise.all(Array.from({ length: workerCount }, worker));
    // A misbehaving injected/native probe must not keep discovery pending forever.
    await Promise.race([scans, new Promise((resolve) => {
      if (controller.signal.aborted) resolve();
      else controller.signal.addEventListener("abort", resolve, { once: true });
    })]);
    return [...found.values()];
  } finally {
    finished = true;
    clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener("abort", abort);
    for (const browser of browsers) { try { browser?.stop(); } catch {} }
  }
}

module.exports = { collectNetworkTargets, discoverNetworkPrinterObservations };
