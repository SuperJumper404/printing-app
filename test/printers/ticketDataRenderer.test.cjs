const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderTicketDataEposXml,
  renderTicketDataEscPos,
  renderTicketDataText,
  validateTicketData,
} = require("../../lib/printers/ticketDataRenderer");
const {
  decoratePrintHistoryEntry,
  getTicketPrintableText,
} = require("../../lib/printers/printHistoryText");

function sampleCashierTicketData(overrides = {}) {
  const shop = overrides.shop || {
    name: "Le Comptoir",
    phone: "0102030405",
    address: "1 rue du Test",
    siret: "123",
    naf: "5610A",
    vatNumber: "FR00123",
  };
  return {
    schemaVersion: 1,
    kind: "cashier_receipt",
    business: {
      orderId: 42,
      orderNumber: "1234",
      shop,
    },
    render: {
      paperWidth: 32,
      sections: [
        {
          id: "shop_header",
          lines: [
            { type: "text", text: shop.name, align: "center", bold: true, size: "double" },
            { type: "text", text: `TEL : ${shop.phone}`, align: "center" },
            { type: "text", text: `SIRET : ${shop.siret}`, align: "center" },
          ],
        },
        {
          id: "items",
          lines: [
            { type: "separator" },
            {
              type: "columns",
              columns: [
                { key: "qty", text: "1x", width: 4 },
                { key: "name", text: "Burger", width: 20 },
                { key: "total", text: "12,00 EUR", width: 8, align: "right" },
              ],
              fallbackText: "1x   Burger              12,00 EUR",
            },
          ],
        },
        {
          id: "totals",
          lines: [
            { type: "text", text: "TOTAL : 12,00 EUR", align: "right", bold: true, size: "double" },
            { type: "feed", lines: 1 },
            { type: "cut" },
          ],
        },
      ],
    },
  };
}

function stripEscPosText(base64Data) {
  const bytes = Buffer.from(base64Data, "base64");
  const output = [];
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    const next = bytes[index + 1];
    if (byte === 0x1b) {
      index += next === 0x40 ? 1 : 2;
      continue;
    }
    if (byte === 0x1d) {
      index += 2;
      continue;
    }
    output.push(byte);
  }
  return Buffer.from(output).toString("utf8");
}

test("renders text from ticketData render sections", () => {
  const text = renderTicketDataText(sampleCashierTicketData());
  assert.match(text, /Le Comptoir/);
  assert.match(text, /1x\s+Burger/);
  assert.match(text, /TOTAL/);
});

test("cashier legal replacements are applied only by renderer", () => {
  const ticketData = sampleCashierTicketData({ shop: { name: "Shop" } });
  ticketData.render.sections[0].lines = [
    { type: "text", text: "Shop", align: "center" },
  ];

  const text = renderTicketDataText(ticketData);
  assert.match(text, /Telephone non renseigne/);
  assert.match(text, /SIRET non renseigne/);
});

test("renders ESC POS and ePOS XML from render lines", () => {
  assert.ok(
    Buffer.from(renderTicketDataEscPos(sampleCashierTicketData()), "base64")
      .length > 0
  );
  assert.match(renderTicketDataEposXml(sampleCashierTicketData()), /<epos-print/);
});

test("rebuilds columns within paper width instead of using oversized fallback", () => {
  const ticketData = sampleCashierTicketData();
  ticketData.render.paperWidth = 32;
  ticketData.render.sections[1].lines = [
    {
      type: "columns",
      size: "double",
      columns: [
        { key: "qty", text: "12x", width: 5 },
        { key: "name", text: "Produit tres tres long", width: 24 },
        { key: "price", text: "1234,00 EUR", width: 10, align: "right" },
      ],
      fallbackText: "12x  Produit tres tres long      1234,00 EUR",
    },
  ];

  const text = stripEscPosText(renderTicketDataEscPos(ticketData, { charsPerLine: 32 }));
  const productLine = text.split(/\r?\n/).find((line) => line.includes("1234,00 EUR"));

  assert.ok(productLine);
  assert.equal(productLine.length, 32);
  assert.doesNotMatch(text, /Produit tres tres long\s+1234,00 EUR/);
});

test("rejects missing render sections", () => {
  assert.equal(
    validateTicketData({ schemaVersion: 1, kind: "cashier_receipt" }).valid,
    false
  );
});

test("history text prefers ticketData over ESC POS text", () => {
  const text = getTicketPrintableText({
    dataFormatESCPOS: Buffer.from("Legacy Shop\n", "utf8").toString("base64"),
    ticketData: sampleCashierTicketData({ shop: { name: "Structured Shop" } }),
  });

  assert.match(text, /Structured Shop/);
  assert.doesNotMatch(text, /Legacy Shop/);
});

test("history entries expose printable text and keep full payload", () => {
  const payload = {
    dataFormatESCPOS: Buffer.from("Legacy Shop\n", "utf8").toString("base64"),
    ticketData: sampleCashierTicketData({ shop: { name: "Structured Shop" } }),
  };
  const entry = decoratePrintHistoryEntry({ id: "history-1", payload });

  assert.match(entry.printableText, /Structured Shop/);
  assert.equal(entry.payload, payload);
});
