const test = require('node:test');
const assert = require('node:assert/strict');
const { getPrimaryLocalIP } = require('../../lib/printers/localNetwork');
test('advertises private networks beyond 192.x and ignores loopback and link-local addresses', () => {
  for (const address of ['10.20.30.40', '172.20.0.9']) {
    assert.equal(getPrimaryLocalIP({ loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }], Ethernet: [{ address: '169.254.0.4', family: 'IPv4' }, { address, family: 'IPv4', internal: false }] }), address);
  }
});
