const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderTicketDataEposXml,
  renderTicketDataEscPos,
  renderTicketDataText,
  validateTicketData,
} = require("../../lib/printers/ticketDataRenderer");
const { getTicketPrintableText } = require("../../lib/printers/printHistoryText");

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
