const test = require("node:test");
const assert = require("node:assert/strict");

let discovery;
try { discovery = require("../../lib/printers/discovery/network"); } catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  discovery = {};
}

test("network targets honor every IPv4 interface and its real netmask", () => {
  assert.equal(typeof discovery.collectNetworkTargets, "function");
  const targets = discovery.collectNetworkTargets({
    Ethernet: [{ family: "IPv4", address: "10.20.1.1", netmask: "255.255.255.252", internal: false }],
    Wifi: [{ family: 4, address: "172.16.9.6", netmask: "255.255.255.252", internal: false }],
    Loopback: [{ family: "IPv4", address: "127.0.0.1", netmask: "255.0.0.0", internal: true }],
    Ipv6: [{ family: "IPv6", address: "::1", internal: false }],
  });
  assert.deepEqual(targets.sort(), ["10.20.1.2", "172.16.9.5"]);
});

test("large subnet scans are bounded, rotate beyond the first /24 and keep known hosts", () => {
  assert.equal(typeof discovery.collectNetworkTargets, "function");
  const interfaces = { Ethernet: [{ family: "IPv4", address: "10.30.0.1", netmask: "255.255.254.0" }] };
  const first = discovery.collectNetworkTargets(interfaces, { maxHosts: 4, cursor: 0 });
  const later = discovery.collectNetworkTargets(interfaces, { maxHosts: 4, cursor: 70 });
  assert.equal(first.length, 4);
  assert.equal(later.length, 4);
  assert.ok(later.some((host) => host.startsWith("10.30.1.")));
  assert.ok(later.some((host) => !first.includes(host)));
  assert.ok(discovery.collectNetworkTargets(interfaces, { maxHosts: 4, knownHosts: ["10.30.1.240"] }).includes("10.30.1.240"));
});

test("a large subnet prioritizes a newly connected printer near every interface address", () => {
  const targets = discovery.collectNetworkTargets({
    Ethernet: [{ family: "IPv4", address: "10.20.30.40", netmask: "255.255.0.0" }],
    Wifi: [{ family: "IPv4", address: "172.22.19.40", netmask: "255.255.0.0" }],
  }, { maxHosts: 512, cursor: 0 });
  assert.ok(targets.includes("10.20.30.50"));
  assert.ok(targets.includes("172.22.19.50"));
  assert.ok(targets.length <= 512);
});

test("network discovery bounds concurrency and reports only detected service ports", async () => {
  assert.equal(typeof discovery.discoverNetworkPrinterObservations, "function");
  let active = 0;
  let peak = 0;
  const observations = await discovery.discoverNetworkPrinterObservations({
    networkInterfaces: { Ethernet: [{ family: "IPv4", address: "10.0.0.1", netmask: "255.255.255.248" }] },
    concurrency: 2, timeoutMs: 100, maxHosts: 5,
    probe: async (host, port) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return host === "10.0.0.4" && port === 9100;
    },
  });
  assert.ok(peak <= 2);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].transports.network9100.available, true);
  assert.equal(observations[0].transports.ipp, undefined);
});

test("mDNS discovers printer services on custom ports and stops browsers at timeout", async () => {
  assert.equal(typeof discovery.discoverNetworkPrinterObservations, "function");
  let stopped = 0;
  const observations = await discovery.discoverNetworkPrinterObservations({
    networkInterfaces: {}, timeoutMs: 15,
    bonjour: { find: (_query, callback) => {
      callback({ name: "Cuisine", fqdn: "Cuisine._ipp._tcp.local", type: "ipp", addresses: ["172.22.10.45"], port: 8631, txt: { rp: "ipp/print" } });
      callback({ name: "Music", fqdn: "Music._airplay._tcp.local", type: "airplay", addresses: ["172.22.10.50"], port: 7000 });
      return { stop() { stopped += 1; } };
    } },
    probe: async (host, port) => host === "172.22.10.45" && port === 8631,
  });
  assert.ok(stopped >= 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].networkIdentity, "Cuisine._ipp._tcp.local");
  assert.equal(observations[0].transports.ipp.config.port, 8631);
  assert.equal(observations[0].transports.ipp.config.path, "/ipp/print");
});

test("a stalled probe cannot keep the discovery operation pending", async () => {
  assert.equal(typeof discovery.discoverNetworkPrinterObservations, "function");
  const started = Date.now();
  const result = await discovery.discoverNetworkPrinterObservations({
    networkInterfaces: {}, knownHosts: ["10.0.0.9"], timeoutMs: 15,
    probe: () => new Promise(() => {}),
  });
  assert.deepEqual(result, []);
  assert.ok(Date.now() - started < 300);
});

test("a bare web server is a candidate and cannot become an enabled Epson route", async () => {
  const [printer] = await discovery.discoverNetworkPrinterObservations({
    networkInterfaces: {}, knownHosts: ["10.0.0.9"], timeoutMs: 100,
    probe: async (_host, port) => port === 80,
  });
  assert.equal(printer.transports.eposHttp.available, false);
  assert.equal(printer.transports.eposHttp.candidate, true);
  assert.equal(printer.transports.eposHttp.enabled, false);
});

test("an explicitly configured Epson host keeps its reachable HTTP route", async () => {
  const [printer] = await discovery.discoverNetworkPrinterObservations({
    networkInterfaces: {}, knownHosts: ["10.0.0.9"], knownEposHosts: ["10.0.0.9"], timeoutMs: 100,
    probe: async (_host, port) => port === 80,
  });
  assert.equal(printer.transports.eposHttp.available, true);
});

test("asynchronous mDNS service probes take priority over a saturated subnet scan", async () => {
  let mdnsProbed = false;
  const observations = await discovery.discoverNetworkPrinterObservations({
    networkInterfaces: { Ethernet: [{ family: "IPv4", address: "10.20.30.40", netmask: "255.255.0.0" }] },
    maxHosts: 512, concurrency: 48, timeoutMs: 100,
    bonjour: { find: (_query, callback) => {
      const announcement = setTimeout(() => callback({ name: "Cuisine", fqdn: "Cuisine._ipp._tcp.local",
        type: "ipp", addresses: ["10.90.9.9"], port: 8631 }), 1);
      return { stop() { clearTimeout(announcement); } };
    } },
    probe: async (host, port) => {
      if (host === "10.90.9.9" && port === 8631) { mdnsProbed = true; return true; }
      await new Promise((resolve) => setTimeout(resolve, 10));
      return false;
    },
  });
  assert.equal(mdnsProbed, true);
  assert.equal(observations.find((item) => item.source === "mdns")?.transports.ipp.config.port, 8631);
});
