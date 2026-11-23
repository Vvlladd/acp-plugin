import http from 'node:http';
import net from 'node:net';
import { realpath, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectWorkflow } from './projection.mjs';
import { reportedModels } from './reported-models.mjs';
import { reviewGate } from './gate-review.mjs';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/workflow-ui.mjs', ['workflow-ui.mjs', 'text/javascript; charset=utf-8']],
]);
const DIR = path.dirname(fileURLToPath(import.meta.url));
// ACP limits incoming requests to 1 MiB; status responses have no writer limit.
// Bound our reader independently, then retry a row-only snapshot if history is too large.
const MAX_FRAME = 16 * 1024 * 1024;
const MAX_BODY = 20000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Rpc {
  constructor(socket, onNotification, onClose) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.next = 1;
    socket.on('data', (chunk) => {
      let remaining = chunk;
      while (remaining.length) {
        const end = remaining.indexOf(10);
        const part = end < 0 ? remaining : remaining.subarray(0, end);
        if (this.buffer.length + part.length > MAX_FRAME) {
          this.oversized = true;
          socket.destroy();
          return;
        }
        this.buffer = Buffer.concat([this.buffer, part]);
        if (end < 0) return;
        let data;
        try {
          const line = new TextDecoder('utf-8', { fatal: true }).decode(this.buffer);
          data = JSON.parse(line);
        } catch {
          socket.destroy();
          return;
        }
        this.buffer = Buffer.alloc(0);
        remaining = remaining.subarray(end + 1);
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.jsonrpc !== '2.0') {
          socket.destroy();
          return;
        }
        if (data.id != null) {
          const pending = this.pending.get(data.id);
          if (!pending) continue;
          this.pending.delete(data.id);
          clearTimeout(pending.timer);
          if (data.error)
            pending.reject(Object.assign(new Error('daemon rejected request'), { definite: true }));
          else pending.resolve(data.result);
        } else {
          onNotification(data);
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('connection closed'));
      }
      this.pending.clear();
      onClose();
    });
  }
  call(method, params, timeout = 10000) {
    if (this.socket.destroyed || this.pending.size >= 32)
      return Promise.reject(new Error('connection unavailable'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('request timed out'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
}

export async function createWorkflowServer({
  repo,
  stateDir,
  port = 4381,
  key = randomBytes(32).toString('base64url'),
}) {
  const root = await realpath(
    execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim(),
  );
  const chosenState = path.resolve(
    stateDir ||
      process.env.ACP_STATE_DIR ||
      path.join(homedir(), '.acp', createHash('sha256').update(root).digest('hex').slice(0, 16)),
  );
  const actualState = await realpath(chosenState).catch(() => chosenState);
  let rpc = null,
    socketClient = null,
    snapshot = null,
    projectedRuns = [],
    events = [],
    connection = 'connecting',
    updatedAt = null,
    retry,
    refreshTimer,
    periodic,
    refreshing = null,
    dirty = false,
    stopped = false,
    baseline = true,
    rowOnly = false;
  const clients = new Set(),
    decisions = new Map(),
    sessions = new Map(),
    modelCache = new Map();
  const socketPath = path.join(actualState, 'acp.sock');
  let host;
  function publish(targets = clients) {
    const runs = projectedRuns;
    const payload = JSON.stringify({ repo: path.basename(root), connection, updatedAt, runs });
    for (const client of targets) {
      if (client.writableLength > 1024 * 1024) client.destroy();
      else client.write(`data: ${payload}\n\n`);
    }
  }
  function mergeEvents(incoming) {
    const map = new Map(events.map((e) => [`${e.runId}:${e.seq}`, e]));
    for (const e of incoming || [])
      if (e && typeof e.runId === 'string' && Number.isSafeInteger(e.seq))
        map.set(`${e.runId}:${e.seq}`, e);
    events = [...map.values()].slice(-1000);
  }
  async function refresh({ broadcast = true } = {}) {
    if (refreshing) return refreshing;
    const current = rpc;
    if (!current) throw new Error('offline');
    refreshing = (async () => {
      const value = await current.call('get_status', {
        lastEvents: baseline && !rowOnly ? 100 : 0,
      });
      if (
        rpc !== current ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        value.schemaVersion !== 1 ||
        !Array.isArray(value.events) ||
        ['runs', 'agents', 'attempts', 'gates'].some(
          (k) => value[k] !== undefined && !Array.isArray(value[k]),
        )
      )
        throw new Error('invalid snapshot');
      const modelIds = await reportedModels(value, actualState, modelCache);
      if (rpc !== current || stopped) throw new Error('connection changed');
      const projected = projectWorkflow(value, [...events, ...value.events], modelIds);
      if (!projected || !Array.isArray(projected.runs)) throw new Error('invalid projection');
      snapshot = value;
      projectedRuns = projected.runs;
      mergeEvents(value.events);
      baseline = false;
      for (const [id, state] of decisions) {
        const gate = (snapshot.gates || []).find((g) => g.gateId === id);
        if ((state === 'unknown' || state === 'completed') && gate && gate.status !== 'pending')
          decisions.delete(id);
      }
      connection = 'live';
      updatedAt = new Date().toISOString();
      if (broadcast) publish();
      return snapshot;
    })()
      .catch((error) => {
        current.socket.destroy();
        throw error;
      })
      .finally(() => {
        refreshing = null;
        if (dirty) {
          dirty = false;
          scheduleRefresh();
        }
      });
    return refreshing;
  }
  function scheduleRefresh() {
    if (refreshing) {
      dirty = true;
      return;
    }
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh().catch(() => rpc?.socket.destroy());
    }, 60);
  }
  function connect() {
    if (stopped) return;
    if (connection !== 'offline') {
      connection = 'connecting';
      publish();
    }
    const socket = net.createConnection(socketPath);
    const current = new Rpc(
      socket,
      (message) => {
        if (rpc !== current) return;
        if (message.params?.protocolVersion !== 1) {
          socket.destroy();
          return;
        }
        if (message.method === 'acp.event') {
          mergeEvents([message.params.event]);
          scheduleRefresh();
        } else if (message.method === 'acp.lagged') {
          events = [];
          baseline = true;
          rowOnly = false;
          scheduleRefresh();
        }
      },
      () => {
        if (socketClient === current) {
          if (current.oversized && baseline) rowOnly = true;
          socketClient = null;
          rpc = null;
          connection = 'offline';
          publish();
        }
        if (!stopped) retry = setTimeout(connect, 1000);
      },
    );
    socketClient = current;
    baseline = true;
    socket.on('connect', async () => {
      try {
        const hello = await current.call('hello', {
          clientName: 'workflow-map',
          clientVersion: '1',
        });
        const daemonRepo = await realpath(hello.repoRoot);
        const daemonState = await realpath(hello.stateDir);
        if (hello.protocolVersion !== 1 || daemonRepo !== root || daemonState !== actualState)
          throw new Error('daemon identity mismatch');
        if (socketClient !== current) throw new Error('disconnected');
        rpc = current;
        await current.call('subscribe', {});
        await refresh();
      } catch {
        socket.destroy();
      }
    });
  }
  function authorized(req, url, stream = false) {
    if (stream) return [...sessions.values()].includes(url.searchParams.get('token'));
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization || '');
    return !!match && sessions.has(match[1]);
  }
  function sameOrigin(req) {
    return req.headers.host === host && req.headers.origin === `http://${host}`;
  }
  function reply(res, code, body) {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  }
  async function body(req) {
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
      throw new Error('content type');
    let size = 0,
      text = '';
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error('body too large');
      text += chunk;
    }
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object')
      throw new Error('invalid body');
    return value;
  }
  async function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (req.headers.host !== host) return reply(res, 403, { error: 'forbidden' });
    let url;
    try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('invalid target');
      url = new URL(req.url, `http://${host}`);
    } catch {
      return reply(res, 400, { error: 'invalid request' });
    }
    if (req.method === 'POST' && url.pathname === '/api/session') {
      if (!sameOrigin(req)) return reply(res, 403, { error: 'forbidden' });
      try {
        const input = await body(req);
        const a = Buffer.from(typeof input.key === 'string' ? input.key : '');
        const b = Buffer.from(key);
        if (Object.keys(input).length !== 1 || a.length !== b.length || !timingSafeEqual(a, b))
          return reply(res, 403, { error: 'forbidden' });
        const token = randomBytes(32).toString('base64url'),
          streamToken = randomBytes(32).toString('base64url');
        sessions.set(token, streamToken);
        if (sessions.size > 128) sessions.delete(sessions.keys().next().value);
        return reply(res, 200, { token, streamToken });
      } catch {
        return reply(res, 400, { error: 'invalid request' });
      }
    }
    if (url.pathname.startsWith('/api/')) {
      if (
        !authorized(req, url, req.method === 'GET' && url.pathname === '/api/events') ||
        (req.headers.origin && !sameOrigin(req))
      )
        return reply(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        clients.add(res);
        req.on('close', () => clients.delete(res));
        publish([res]);
        return;
      }
      // Conversations and authority changes use the decision credential, never the SSE token.
      const runRoute = /^\/api\/runs\/([0-9a-f-]+)\/(authorize-lead|transcript)$/i.exec(url.pathname);
      if (runRoute && UUID.test(runRoute[1])) {
        if (req.method !== 'POST' || !sameOrigin(req))
          return reply(res, 403, { error: 'forbidden' });
        let input;
        try { input = await body(req); } catch { return reply(res, 400, { error: 'invalid request' }); }
        const id = runRoute[1], transcript = runRoute[2] === 'transcript';
        if (transcript ?
          (Object.keys(input).some((k) => !['agentId', 'afterSeq'].includes(k)) ||
           !UUID.test(input.agentId || '') ||
           (input.afterSeq !== undefined && (!Number.isSafeInteger(input.afterSeq) || input.afterSeq < 0))) :
          Object.keys(input).length !== 0)
          return reply(res, 400, { error: 'invalid request' });
        let current;
        try {
          await refresh({ broadcast: false });
          current = rpc;
          if (!current || !(snapshot.runs || []).some((r) => r.runId === id) ||
              (transcript && !(snapshot.agents || []).some((a) => a.runId === id && a.agentId === input.agentId)))
            return reply(res, 404, { error: 'run or worker unavailable' });
        } catch { return reply(res, 503, { error: 'Daemon unavailable; request was not submitted.' }); }
        const prior = decisions.get(`lead:${id}`);
        const authorized = (snapshot.runs || []).some((r) => r.runId === id && r.execution?.leadApprovalRunId === id);
        if (!transcript && (authorized || prior === 'completed'))
          return reply(res, 200, { runId: id, leadApproved: true });
        if (!transcript && prior)
          return reply(res, 503, { error: 'Authorization is in progress or its outcome is unknown; inspect the run before retrying.' });
        if (!transcript) decisions.set(`lead:${id}`, 'resolving');
        try {
          const params = transcript ? { runId: id, ...input } : { runId: id };
          const result = await current.call(transcript ? 'run.transcript' : 'run.authorize_lead', params,
            transcript ? 10000 : 90000);
          if (!transcript) {
            if (result?.runId !== id || result.leadApproved !== true) throw new Error('invalid response');
            decisions.set(`lead:${id}`, 'completed');
            scheduleRefresh();
            return reply(res, 200, { runId: id, leadApproved: true });
          }
          if (result?.runId !== id || result.agentId !== input.agentId ||
              !Array.isArray(result.messages) || result.messages.length > 500 ||
              typeof result.historyIncomplete !== 'boolean' ||
              !(result.nextAfterSeq === null || Number.isSafeInteger(result.nextAfterSeq)))
            throw new Error('invalid response');
          let last = input.afterSeq ?? -1;
          const messages = result.messages.map((m) => {
            if (!Number.isSafeInteger(m.seq) || m.seq <= last ||
                !['lead', 'builder', 'verifier', 'reviewer', 'security', 'workflow'].includes(m.sender) ||
                !['lead', 'builder', 'verifier', 'reviewer', 'security', 'workflow'].includes(m.recipient) ||
                typeof m.kind !== 'string' || !/^[\w.-]{1,100}$/.test(m.kind) ||
                typeof m.text !== 'string' || m.text.length > 20000 || typeof m.truncated !== 'boolean' ||
                !(m.attemptId === null || UUID.test(m.attemptId || ''))) throw new Error('invalid message');
            last = m.seq;
            return { seq: m.seq, attemptId: m.attemptId, sender: m.sender, recipient: m.recipient,
              kind: m.kind, text: m.text, truncated: m.truncated };
          });
          if (result.nextAfterSeq !== null &&
              (result.nextAfterSeq < last || result.nextAfterSeq <= (input.afterSeq ?? -1)))
            throw new Error('invalid cursor');
          return reply(res, 200, { runId: id, agentId: input.agentId, messages,
            nextAfterSeq: result.nextAfterSeq, historyIncomplete: result.historyIncomplete });
        } catch (error) {
          if (!transcript) {
            if (error.definite) decisions.delete(`lead:${id}`);
            else decisions.set(`lead:${id}`, 'unknown');
          }
          return reply(res, error.definite ? 409 : 503, { error: transcript
            ? 'Transcript unavailable or unsupported by this daemon.'
            : error.definite ? 'Daemon rejected or does not support lead authorization.'
            : 'Authorization outcome is unknown; inspect the run before retrying.' });
        }
      }
      const match = /^\/api\/gates\/([0-9a-f-]+)(\/decision)?$/i.exec(url.pathname);
      if (!match || !UUID.test(match[1])) return reply(res, 404, { error: 'not found' });
      const id = match[1];
      if (req.method === 'GET' && !match[2]) {
        try {
          await refresh({ broadcast: false });
          const gate = (snapshot.gates || []).find((g) => g.gateId === id);
          if (!gate) return reply(res, 404, { error: 'not found' });
          return reply(res, 200, await reviewGate(gate, actualState));
        } catch {
          return reply(res, 503, { error: 'review unavailable' });
        }
      }
      if (req.method !== 'POST' || !match[2] || !sameOrigin(req))
        return reply(res, 403, { error: 'forbidden' });
      let input;
      try {
        input = await body(req);
      } catch {
        return reply(res, 400, { error: 'invalid request' });
      }
      if (
        Object.keys(input).some(
          (k) => !['decision', 'runId', 'diffHash', 'feedback'].includes(k),
        ) ||
        !['approve', 'deny'].includes(input.decision) ||
        !UUID.test(input.runId || '') ||
        (input.feedback !== undefined &&
          (typeof input.feedback !== 'string' || [...input.feedback].length > 8000)) ||
        (input.diffHash !== undefined &&
          (typeof input.diffHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.diffHash))) ||
        (input.decision === 'approve' && input.feedback !== undefined)
      )
        return reply(res, 400, { error: 'invalid request' });
      if (decisions.has(id))
        return reply(res, 409, { error: 'decision already submitted or outcome unknown' });
      decisions.set(id, 'checking');
      let submitted = false;
      let decisionRpc;
      try {
        await refresh({ broadcast: false });
        decisionRpc = rpc;
        const gate = (snapshot.gates || []).find((g) => g.gateId === id);
        if (
          !decisionRpc ||
          !gate ||
          gate.runId !== input.runId ||
          gate.status !== 'pending' ||
          !['integrate', 'plan', 'escalate'].includes(gate.kind)
        ) {
          decisions.delete(id);
          return reply(res, 409, { error: 'gate is no longer pending' });
        }
        const review = await reviewGate(gate, actualState);
        if (
          review.id !== id ||
          review.runId !== input.runId ||
          review.status !== 'pending' ||
          (input.decision === 'approve' ? !review.canApprove : !review.canDeny) ||
          (gate.kind === 'integrate' &&
            input.decision === 'approve' &&
            (!review.diffHash || input.diffHash !== review.diffHash))
        ) {
          decisions.delete(id);
          return reply(res, 409, { error: 'review changed or action unavailable' });
        }
        // Recheck after asynchronous evidence reading; no decision is sent against a changed snapshot.
        await refresh({ broadcast: false });
        const currentGate = (snapshot.gates || []).find((g) => g.gateId === id);
        if (
          rpc !== decisionRpc ||
          !currentGate ||
          JSON.stringify(currentGate) !== JSON.stringify(gate)
        ) {
          decisions.delete(id);
          return reply(res, 409, { error: 'gate changed' });
        }
        submitted = true;
        decisions.set(id, 'resolving');
        const params = { gateId: id };
        if (input.decision === 'deny' && input.feedback !== undefined)
          params.feedback = input.feedback;
        const result = await decisionRpc.call(`gate.${input.decision}`, params, 120000);
        if (!result || !['approved', 'denied', 'already_resolved'].includes(result.status)) {
          throw new Error('invalid decision response');
        }
        decisions.set(id, 'completed');
        scheduleRefresh();
        return reply(res, 200, { status: result.status });
      } catch (error) {
        if (!submitted) {
          decisions.delete(id);
          return reply(res, 409, { error: 'Decision was not submitted; review and try again.' });
        }
        // An RPC error can follow a failed commit after the resolving marker was written.
        // Only a same-connection, subsequent pending snapshot proves a rejection had no effect.
        if (error.definite && rpc === decisionRpc) {
          try {
            await refresh({ broadcast: false });
            const currentGate = (snapshot.gates || []).find((g) => g.gateId === id);
            if (rpc === decisionRpc && currentGate?.status === 'pending') {
              decisions.delete(id);
              return reply(res, 409, {
                error: 'Daemon rejected the decision; review and try again.',
              });
            }
          } catch {
            /* A lost confirmation is an uncertain outcome. */
          }
        }
        decisions.set(id, 'unknown');
        scheduleRefresh();
        return reply(res, 202, { status: 'unknown' });
      }
    }
    if (req.method !== 'GET' || !ASSETS.has(url.pathname))
      return reply(res, 404, { error: 'not found' });
    const [file, type] = ASSETS.get(url.pathname);
    try {
      const data = await readFile(path.join(DIR, 'public', file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(data);
    } catch {
      reply(res, 404, { error: 'not found' });
    }
  }
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: 'request failed' });
      else res.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  host = `127.0.0.1:${server.address().port}`;
  connect();
  periodic = setInterval(() => {
    if (rpc) scheduleRefresh();
  }, 15000);
  return {
    url: `http://${host}/#key=${key}`,
    close: async () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(refreshTimer);
      clearInterval(periodic);
      socketClient?.socket.destroy();
      for (const c of clients) c.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let repo = process.cwd(),
      stateDir,
      port = 4381;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (!['--repo', '--state-dir', '--port'].includes(args[i]) || i + 1 >= args.length)
        throw new Error('usage: node serve.mjs [--repo path] [--state-dir path] [--port 0..65535]');
      const name = args[i],
        value = args[++i];
      if (name === '--repo') repo = value;
      else if (name === '--state-dir') stateDir = value;
      else {
        if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('invalid port');
        port = Number(value);
      }
    }
    const server = await createWorkflowServer({ repo, stateDir, port });
    console.log(server.url);
  } catch (error) {
    console.error(`workflow-map: ${error.message}`);
    process.exitCode = 1;
  }
}
