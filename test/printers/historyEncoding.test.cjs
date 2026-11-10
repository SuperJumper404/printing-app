const test = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');
const { getTicketPrintableText } = require('../../lib/printers/printHistoryText');
const { renderTicketDataEscPos } = require('../../lib/printers/ticketDataRenderer');

test('history decodes UTF-8 accents and euro signs without mojibake', () => {
  const dataFormatESCPOS = Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from('Crème brûlée — 3,00 €\n')]).toString('base64');
  assert.equal(getTicketPrintableText({ dataFormatESCPOS }), 'Crème brûlée — 3,00 €\n');
});
test('history decodes an explicitly selected printer code page', () => {
  assert.equal(getTicketPrintableText({ encoding: 'cp858', dataFormatESCPOS: iconv.encode('Crème 3,00 €\n', 'cp858').toString('base64') }), 'Crème 3,00 €\n');
});
test('structured rendering encodes text before combining binary ESC POS commands', () => {
  const ticketData = { schemaVersion: 1, kind: 'order_ticket', render: { sections: [{ lines: [{ type: 'text', text: 'Crème €', bold: true }, { type: 'cut' }] }] } };
  const rendered = Buffer.from(renderTicketDataEscPos(ticketData, { encoding: 'cp858' }), 'base64');
  assert.ok(rendered.includes(iconv.encode('Crème €', 'cp858')));
  assert.ok(rendered.includes(Buffer.from([0x1d, 0x56, 0])));
});
