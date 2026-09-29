const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectUsbBulkOutEndpoint,
  describeUsbAvailability,
} = require("../../lib/printers/webUsbConfig");

const interfaces = [
  {
    interfaceNumber: 0,
    alternates: [
      {
        alternateSetting: 0,
        interfaceClass: 255,
        endpoints: [{ endpointNumber: 2, direction: "out", type: "bulk", packetSize: 64 }],
      },
    ],
  },
  {
    interfaceNumber: 1,
    alternates: [
      {
        alternateSetting: 0,
        interfaceClass: 7,
        endpoints: [
          { endpointNumber: 3, direction: "in", type: "bulk", packetSize: 64 },
          { endpointNumber: 4, direction: "out", type: "bulk", packetSize: 64 },
        ],
      },
    ],
  },
];

test("selects a bulk OUT endpoint and prefers printer-class interfaces", () => {
  assert.deepEqual(selectUsbBulkOutEndpoint(interfaces), {
    interfaceNumber: 1,
    alternateSetting: 0,
    endpointNumber: 4,
    packetSize: 64,
    interfaceClass: 7,
  });
});

test("returns no endpoint for input-only devices", () => {
  assert.equal(
    selectUsbBulkOutEndpoint([
      {
        interfaceNumber: 0,
        alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }] }],
      },
    ]),
    null,
  );
});

test("preserves an explicit valid endpoint selection", () => {
  assert.deepEqual(
    selectUsbBulkOutEndpoint(interfaces, { interfaceNumber: 0, endpointNumber: 2 }),
    {
      interfaceNumber: 0,
      alternateSetting: 0,
      endpointNumber: 2,
      packetSize: 64,
      interfaceClass: 255,
    },
  );
});

test("returns actionable unavailable reasons for authorization and claimed interfaces", () => {
  assert.match(describeUsbAvailability({ authorized: false }).reason, /autoriser/i);
  assert.match(
    describeUsbAvailability({ authorized: true, claimError: new Error("Access denied") }).reason,
    /Windows|interface/i,
  );
  assert.equal(describeUsbAvailability({ authorized: true }).available, true);
});
