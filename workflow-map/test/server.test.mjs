import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWorkflowServer } from '../serve.mjs';

const runId = '11111111-1111-4111-8111-111111111111',
  gateId = '22222222-2222-4222-8222-222222222222',
  agentId = '33333333-3333-4333-8333-333333333333';
async function fixture({ wrongRepo = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'workflow-test-'));
  const repo = path.join(dir, 'repo'),
    state = path.join(dir, 'state');
  await mkdir(repo);
  await mkdir(state);
  execFileSync('git', ['init', '-q', repo]);
  let status = {
    schemaVersion: 1,
    runs: [{ runId, status: 'running', task: { title: 'Example' }, lastSeq: 1 }],
    agents: [{ runId, agentId, role: 'builder' }],
    gates: [{ gateId, runId, kind: 'plan', status: 'pending', summary: 'Proceed?' }],
    events: [],
  };
  let calls = [],
    peers = new Set(),
    dropDecision = false,
    rejectDecision = false,
    rejectAuthorization = false;
  const daemon = net.createServer((socket) => {
    peers.add(socket);
    socket.on('close', () => peers.delete(socket));
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk;
      let n;
      while ((n = input.indexOf('\n')) >= 0) {
        const frame = JSON.parse(input.slice(0, n));
        input = input.slice(n + 1);
        calls.push(frame);
        let result = {};
        if (frame.method === 'hello')
          result = {
            protocolVersion: 1,
            repoRoot: wrongRepo ? os.tmpdir() : repo,
            stateDir: state,
          };
        if (frame.method === 'get_status') result = status;
        if (frame.method === 'run.authorize_lead') {
          if (rejectAuthorization) {
            socket.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'rejected' } }) + '\n');
            continue;
          }
          result = { runId, leadApproved: true };
        }
        if (frame.method === 'run.transcript') result = {
          runId, agentId, historyIncomplete: true, nextAfterSeq: null,
          messages: [{ seq: 2, attemptId: agentId, sender: 'lead', recipient: 'builder',
            kind: 'task', text: 'private selected message', truncated: false }],
        };
        if (frame.method.startsWith('gate.')) {
          if (dropDecision) {
            socket.destroy();
            continue;
          }
          if (rejectDecision) {
            socket.write(
              JSON.stringify({
                jsonrpc: '2.0',
                id: frame.id,
                error: { code: -32000, message: 'rejected' },
              }) + '\n',
            );
            continue;
          }
          result = { status: frame.method === 'gate.approve' ? 'approved' : 'denied' };
          status = {
            ...status,
            gates: status.gates.map((g) => ({
              ...g,
              status: frame.method === 'gate.approve' ? 'approved' : 'denied',
            })),
          };
        }
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n');
      }
    });
  });
  await new Promise((resolve) => daemon.listen(path.join(state, 'acp.sock'), resolve));
  const app = await createWorkflowServer({ repo, stateDir: state, port: 0, key: 'test-secret' });
  const origin = app.url.split('/#')[0];
  async function request(url, options = {}) {
    return fetch(origin + url, options);
  }
  async function pair() {
    const response = await request('/api/session', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'test-secret' }),
    });
    return await response.json();
  }
  async function ready(session) {
    for (let i = 0; i < 100; i++) {
      const r = await request(`/api/gates/${gateId}`, {
        headers: { authorization: `Bearer ${session.token}` },
      });
      if (r.status === 200) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error('not ready');
  }
  return {
    request,
    pair,
    ready,
    origin,
    calls,
    state,
    malformed() {
      for (const p of peers) p.write('null\n');
    },
    setStatus(v) {
      status = v;
    },
    setDrop() {
      dropDecision = true;
    },
    setReject(value) {
      rejectDecision = value;
    },
    setRejectAuthorization(value) { rejectAuthorization = value; },
    notify(e) {
      for (const p of peers)
        p.write(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'acp.event',
            params: { protocolVersion: 1, event: e },
          }) + '\n',
        );
    },
    async close() {
      await app.close();
      for (const p of peers) p.destroy();
      await new Promise((resolve) => daemon.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('selected transcript and run authorization require the privileged paired scope', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  const path = `/api/runs/${runId}/transcript`;
  const headers = { authorization: `Bearer ${session.token}`, origin: f.origin, 'content-type': 'application/json' };
  const post = (url, payload, h = headers) => f.request(url, { method: 'POST', headers: h, body: JSON.stringify(payload) });
  assert.equal((await post(path, { agentId }, { ...headers, authorization: `Bearer ${session.streamToken}` })).status, 403);
  assert.equal((await post(path, { agentId }, { ...headers, origin: 'http://evil.example' })).status, 403);
  assert.equal((await post(path, { agentId: gateId })).status, 404);
  assert.equal((await post(`/api/runs/${gateId}/transcript`, { agentId })).status, 404);
  const response = await post(path, { agentId });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).messages[0].text, 'private selected message');
  assert.equal((await post(`/api/runs/${runId}/authorize-lead`, {})).status, 200);
  assert.equal((await post(`/api/runs/${runId}/authorize-lead`, {})).status, 200);
  assert.equal(f.calls.filter((c) => c.method === 'run.authorize_lead').length, 1);
  const controller = new AbortController();
  const stream = await f.request(`/api/events?token=${session.streamToken}`, { signal: controller.signal });
  const content = new TextDecoder().decode((await stream.body.getReader().read()).value);
  assert.ok(!content.includes('private selected message'));
  controller.abort();
});
test('rejected lead authorization can be retried', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  const post = () => f.request(`/api/runs/${runId}/authorize-lead`, { method: 'POST',
    headers: { authorization: `Bearer ${session.token}`, origin: f.origin, 'content-type': 'application/json' }, body: '{}' });
  f.setRejectAuthorization(true);
  assert.equal((await post()).status, 409);
  f.setRejectAuthorization(false);
  assert.equal((await post()).status, 200);
  assert.equal(f.calls.filter((c) => c.method === 'run.authorize_lead').length, 2);
});
test('authenticated stream tracks status changes and rejects cross-origin and unpaired access', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  assert.equal((await f.request('/api/events')).status, 403);
  assert.equal(
    (
      await f.request('/api/session', {
        method: 'POST',
        headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
        body: '{"key":"test-secret"}',
      })
    ).status,
    403,
  );
  const session = await f.pair();
  await f.ready(session);
  assert.equal(
    (
      await f.request(`/api/events?token=${session.streamToken}`, {
        headers: { origin: 'http://evil.example' },
      })
    ).status,
    403,
  );
  const controller = new AbortController();
  const response = await f.request(`/api/events?token=${session.streamToken}`, {
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"connection":"live"/);
  assert.match(first, /Example/);
  f.setStatus({
    schemaVersion: 1,
    runs: [
      { runId, status: 'completed', task: { title: 'Changed' }, lastSeq: 2 },
      {
        runId: '44444444-4444-4444-8444-444444444444',
        status: 'running',
        task: { title: 'New run' },
        lastSeq: 3,
      },
    ],
    gates: [],
    events: [],
  });
  f.notify({ runId, seq: 2, kind: 'run.status' });
  let received = '';
  for (let i = 0; i < 5 && !received.includes('Changed'); i++)
    received += new TextDecoder().decode((await reader.read()).value);
  assert.match(received, /Changed/);
  assert.match(received, /New run/);
  controller.abort();
});
test('gate actions require current scope and explicit same-origin human request', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  const headers = {
    authorization: `Bearer ${session.token}`,
    origin: f.origin,
    'content-type': 'application/json',
  };
  const send = (data, extra = {}) =>
    f.request(`/api/gates/${gateId}/decision`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(data),
    });
  assert.equal(
    (await send({ decision: 'approve', runId }, { origin: 'http://evil.example' })).status,
    403,
  );
  assert.equal(
    (await send({ decision: 'approve', runId: '33333333-3333-4333-8333-333333333333' })).status,
    409,
  );
  assert.equal((await send({ decision: 'approve', runId })).status, 200);
  assert.equal(f.calls.filter((c) => c.method === 'gate.approve').length, 1);
  assert.equal((await send({ decision: 'approve', runId })).status, 409);
});
test('denial carries feedback and uncertain results are never retried', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  const send = () =>
    f.request(`/api/gates/${gateId}/decision`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        origin: f.origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ decision: 'deny', runId, feedback: 'Please revise' }),
    });
  f.setDrop();
  assert.equal((await send()).status, 202);
  assert.equal((await send()).status, 409);
  const calls = f.calls.filter((c) => c.method === 'gate.deny');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.feedback, 'Please revise');
});

test('integration approval binds the displayed hash and rejects mismatches', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  const gateDir = path.join(f.state, 'runs', runId, 'gates');
  const diffDir = path.join(f.state, 'runs', runId.replaceAll('-', ''), 'diffs');
  await mkdir(gateDir, { recursive: true });
  await mkdir(diffDir, { recursive: true });
  const diff = 'diff --git a/a b/a\n';
  const hash = createHash('sha256').update(diff).digest('hex');
  const diffPath = path.join(diffDir, '33333333-3333-4333-8333-333333333333.patch');
  const payloadPath = path.join(gateDir, `${gateId}.payload.json`);
  await writeFile(diffPath, diff);
  await writeFile(
    payloadPath,
    JSON.stringify({ diffPath, diffHash: hash, worktree: '/tmp/work', preSha: 'abc' }),
  );
  f.setStatus({
    schemaVersion: 1,
    runs: [{ runId, status: 'running', lastSeq: 1 }],
    gates: [{ gateId, runId, kind: 'integrate', status: 'pending', payloadPath }],
    events: [],
  });
  const headers = {
    authorization: `Bearer ${session.token}`,
    origin: f.origin,
    'content-type': 'application/json',
  };
  const review = await (await f.request(`/api/gates/${gateId}`, { headers })).json();
  assert.equal(review.diffHash, hash);
  const decide = (diffHash) =>
    f.request(`/api/gates/${gateId}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'approve', runId, diffHash }),
    });
  assert.equal((await decide('0'.repeat(64))).status, 409);
  assert.equal(f.calls.filter((c) => c.method === 'gate.approve').length, 0);
  assert.equal((await decide(review.diffHash)).status, 200);
  assert.equal(f.calls.filter((c) => c.method === 'gate.approve').length, 1);
});

test('malformed daemon and HTTP frames do not crash the server', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  f.malformed();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const url = new URL(f.origin);
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(Number(url.port), url.hostname, () =>
      socket.write(`GET http://[ HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`),
    );
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
  assert.match(response, /400/);
  assert.equal((await f.request('/')).status, 200);
});

test('rejects daemon for another repository before requesting status', async (t) => {
  const f = await fixture({ wrongRepo: true });
  t.after(() => f.close());
  const session = await f.pair();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const response = await f.request(`/api/gates/${gateId}`, {
    headers: { authorization: `Bearer ${session.token}` },
  });
  assert.equal(response.status, 503);
  assert.equal(f.calls.filter((c) => c.method === 'get_status').length, 0);
});

test('a rejected daemon decision returns a definite retryable response', async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const session = await f.pair();
  await f.ready(session);
  const send = () =>
    f.request(`/api/gates/${gateId}/decision`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.token}`,
        origin: f.origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ decision: 'deny', runId }),
    });
  f.setReject(true);
  assert.equal((await send()).status, 409);
  f.setReject(false);
  const response = await send();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'denied');
});

test('offline preflight is reported as unsubmitted', async (t) => {
  const f = await fixture({ wrongRepo: true });
  t.after(() => f.close());
  const session = await f.pair();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const response = await f.request(`/api/gates/${gateId}/decision`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session.token}`,
      origin: f.origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ decision: 'deny', runId }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not submitted/);
  assert.equal(f.calls.filter((c) => c.method.startsWith('gate.')).length, 0);
});
