const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServiceClient } = require('../../lib/desktop/serviceClient');

async function setup(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smarteat-client-'));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({ controlPort: server.address().port, token: 'a'.repeat(64), host: 'untrusted.example' }));
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return createServiceClient({ dataDir: dir, allowInsecureControlForTests: true });
}

test('uses the authenticated loopback API and returns only the unwrapped value', async t => {
  const client = await setup(t, (req, res) => {
    assert.equal(req.url, '/control');
    assert.equal(req.headers.authorization, `Bearer ${'a'.repeat(64)}`);
    let body = ''; req.on('data', chunk => { body += chunk; });
    req.on('end', () => { const input = JSON.parse(body); assert.equal(input.action, 'get-saved-printers'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, value: [{ id: 'one', favorite: true }] })); });
  });
  const result = await client.request('get-saved-printers');
  assert.deepEqual(result, [{ id: 'one', favorite: true }]);
  assert.doesNotMatch(JSON.stringify(result), /aaaaaaa/);
});

test('bounds a stalled service request and does not expose credentials', async t => {
  const client = await setup(t, () => {});
  await assert.rejects(client.request('get-saved-printers', null, { timeoutMs: 25 }), error => {
    assert.equal(error.code, 'SERVICE_UNAVAILABLE'); assert.doesNotMatch(error.message, /aaaaaaa|Bearer/); return true;
  });
});

test('forwards typed service errors without leaking server stack or private details', async t => {
  const client = await setup(t, (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: { code: 'CONFIGURATION', message: 'Configuration à vérifier', stack: 'private data', token: 'secret' } })); });
  await assert.rejects(client.request('save-printer-config', []), error => {
    assert.equal(error.code, 'CONFIGURATION'); assert.equal(error.message, 'Configuration à vérifier'); assert.equal(error.token, undefined); return true;
  });
});

test('missing installation reports service unavailable with an actionable French message', async () => {
  const client = createServiceClient({ dataDir: path.join(os.tmpdir(), 'smarteat-no-service-' + Date.now()) });
  await assert.rejects(client.request('get-service-status'), error => error.code === 'SERVICE_UNAVAILABLE' && /service Windows/i.test(error.message));
});

test('preserves typed application errors on HTTP 400 so a companion can recover after service restart', async t => {
  const client = await setup(t, (req, res) => { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: { code: 'BROKER_RESTARTED', message: 'Le service a redémarré.' } })); });
  await assert.rejects(client.request('companion:respond', { brokerId: 'old' }), error => error.code === 'BROKER_RESTARTED');
});
