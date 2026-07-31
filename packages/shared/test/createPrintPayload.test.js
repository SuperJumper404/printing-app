import test from "node:test";
import assert from "node:assert/strict";

import { createPrintPayload } from "../src/index.js";

test("createPrintPayload returns the ticket type and ESC/POS payload", () => {
  assert.deepEqual(
    createPrintPayload({
      ticketType: "kitchen",
      dataFormatESCPOS: "SGVsbG8=",
    }),
    {
      ticketType: "kitchen",
      dataFormatESCPOS: "SGVsbG8=",
    }
  );
});

test("createPrintPayload requires a ticket type", () => {
  assert.throws(
    () =>
      createPrintPayload({
        ticketType: "",
        dataFormatESCPOS: "SGVsbG8=",
      }),
    /ticketType is required/
  );
});

test("createPrintPayload requires an ESC/POS payload", () => {
  assert.throws(
    () =>
      createPrintPayload({
        ticketType: "kitchen",
        dataFormatESCPOS: "",
      }),
    /dataFormatESCPOS is required/
  );
});
