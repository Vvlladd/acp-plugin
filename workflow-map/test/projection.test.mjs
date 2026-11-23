import test from 'node:test';
import assert from 'node:assert/strict';
import { projectWorkflow } from '../projection.mjs';

test('older snapshots recover agent relationships only from bounded matching creation events', () => {
  const runs = [{ runId: 'r', lastSeq: 4 }, { runId: 'other', lastSeq: 9 }, { runId: 'unbounded' }];
  const agents = [
    { runId: 'r', agentId: 'lead', role: 'lead' },
    { runId: 'r', agentId: 'builder', role: 'builder' },
    { runId: 'r', agentId: 'check', role: 'reviewer' },
    { runId: 'r', agentId: 'future', role: 'builder' },
    { runId: 'r', agentId: 'foreign', role: 'builder' },
    { runId: 'r', agentId: 'explicit', role: 'builder', origin: 'control-plane', parentAgentId: null },
    { runId: 'unbounded', agentId: 'lead2', role: 'lead' },
    { runId: 'unbounded', agentId: 'worker2', role: 'builder' },
  ];
  const events = [
    { runId: 'r', seq: 1, kind: 'agent.created', agentId: 'builder', role: 'builder', origin: 'lead' },
    { runId: 'r', seq: 2, kind: 'agent.created', agentId: 'check', role: 'reviewer', origin: 'control-plane', parentAgentId: 'builder' },
    { runId: 'r', seq: 3, kind: 'agent.created', agentId: 'explicit', role: 'builder', origin: 'lead', parentAgentId: 'lead' },
    { runId: 'r', seq: 5, kind: 'agent.created', agentId: 'future', role: 'builder', origin: 'lead' },
    { runId: 'other', seq: 1, kind: 'agent.created', agentId: 'foreign', role: 'builder', origin: 'lead' },
    { runId: 'unbounded', seq: 1, kind: 'agent.created', agentId: 'worker2', role: 'builder', origin: 'lead' },
  ];
  const projected = projectWorkflow({ runs, agents, events }).runs;
  const root = projected.find((r) => r.id === 'r');
  const has = (from, to, kind) => root.edges.some((e) => e.from === from && e.to === to && e.kind === kind);
  assert.ok(has('agent:lead', 'agent:builder', 'delegation'));
  assert.ok(has('agent:builder', 'agent:check', 'delegation'));
  for (const id of ['future', 'foreign', 'explicit']) assert.ok(has('run:r', `agent:${id}`, 'membership'));
  const unbounded = projected.find((r) => r.id === 'unbounded');
  assert.ok(unbounded.edges.some((e) => e.from === 'run:unbounded' && e.to === 'agent:worker2' && e.kind === 'membership'));
});

test('links a lead to its own worker and the uniquely identified child worker', () => {
  const runs = [{ runId: 'root', lastSeq: 1 }, { runId: 'child', lastSeq: 0 }];
  const agents = [
    { runId: 'root', agentId: 'lead', role: 'lead' },
    { runId: 'root', agentId: 'same', role: 'builder', origin: 'lead' },
    { runId: 'child', agentId: 'child-builder', role: 'builder', origin: 'lead' },
  ];
  const events = [{ runId: 'root', seq: 1, kind: 'run.delegated', delegatedRunId: 'child', target: 'worker', role: 'builder' }];
  const root = projectWorkflow({ runs, agents, events }).runs.find((r) => r.id === 'root');
  assert.ok(root.edges.some((e) => e.from === 'agent:lead' && e.to === 'agent:same' && e.kind === 'delegation'));
  assert.ok(root.edges.some((e) => e.from === 'agent:lead' && e.to === 'delegation:run-child' && e.kind === 'delegation'));
  assert.equal(root.nodes.find((n) => n.id === 'delegation:run-child').workerAgentId, 'child-builder');
});

test('unknown parent and ambiguous leads or child workers use conservative fallback', () => {
  const runs = [{ runId: 'root', lastSeq: 1 }, { runId: 'child' }];
  const agents = [
    { runId: 'root', agentId: 'lead-a', role: 'lead' },
    { runId: 'root', agentId: 'lead-b', role: 'lead' },
    { runId: 'root', agentId: 'unknown-parent', role: 'builder', origin: 'lead', parentAgentId: 'missing' },
    { runId: 'root', agentId: 'ambiguous', role: 'builder', origin: 'lead' },
    { runId: 'child', agentId: 'one', role: 'builder', origin: 'lead' },
    { runId: 'child', agentId: 'two', role: 'builder', origin: 'lead' },
  ];
  const events = [{ runId: 'root', seq: 1, kind: 'run.delegated', delegatedRunId: 'child', target: 'worker', role: 'builder' }];
  const root = projectWorkflow({ runs, agents, events }).runs.find((r) => r.id === 'root');
  for (const id of ['agent:unknown-parent', 'agent:ambiguous', 'delegation:run-child']) {
    assert.ok(root.edges.some((e) => e.from === 'run:root' && e.to === id));
  }
  assert.equal(root.nodes.find((n) => n.id === 'delegation:run-child').workerAgentId, undefined);
});

test('offers terminal plan authorization only for its own root', () => {
  const runs = ['root', 'child'].map((runId) => ({ runId, status: 'running', execution: {
    mode: 'build', terminalLeadRequested: true, leadOwnerRunId: 'root',
  } }));
  const result = projectWorkflow({ runs }).runs;
  assert.equal(result.find((r) => r.id === 'root').nodes.find((n) => n.kind === 'run').canAuthorizeLead, true);
  assert.equal(result.find((r) => r.id === 'child').nodes.find((n) => n.kind === 'run').canAuthorizeLead, false);
});

test('attributes recorded authority and preserves worker identity without streaming transcript text', () => {
  const runId = 'r', agentId = 'a';
  const result = projectWorkflow({
    runs: [{ runId, execution: { leadApprovalRunId: runId } }],
    agents: [{ runId, agentId, role: 'builder' }],
    gates: [{ runId, gateId: 'g', status: 'approved', resolvedBy: 'lead', leadDecision: true }],
    events: [{ runId, seq: 1, kind: 'gate.resolving', by: 'lead', leadDecision: true, text: 'secret' }],
  }).runs[0];
  assert.equal(result.nodes.find((n) => n.kind === 'run').leadApproved, true);
  assert.equal(result.nodes.find((n) => n.kind === 'agent').agentId, agentId);
  assert.equal(result.nodes.find((n) => n.kind === 'gate').subtitle, 'Approved by the lead');
  assert.match(result.activity[0].label, /Lead/);
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('surfaces a native permission wait without exposing provider prose', () => {
  const result = projectWorkflow({
    runs: [{ runId: 'r' }],
    agents: [{ runId: 'r', agentId: 'a', role: 'builder' }],
    attempts: [{ runId: 'r', agentId: 'a', attemptId: 't', error: {
      code: 'native_permission_required', message: 'secret command' } }],
  }).runs[0];
  const worker = result.nodes.find((n) => n.kind === 'agent');
  assert.equal(worker.status, 'waiting_for_native_permission');
  assert.match(worker.details.find((d) => d.label === 'Native access').value, /verification is unavailable/);
  assert.ok(!JSON.stringify(result).includes('secret command'));
});

test('opted-in runs identify which pending decision still needs the person', () => {
  const runId = 'parent';
  const view = projectWorkflow({
    runs: [{ runId, execution: { leadApprovalRunId: runId } }],
    gates: ['integrate', 'plan', 'escalate'].map(kind => ({ gateId: kind, runId, kind, status: 'pending' })),
  }).runs[0];
  const gates = view.nodes.filter(n => n.kind === 'gate');
  assert.deepEqual(gates.map(n => [n.gateKind, n.awaitingLead]).sort(),
    [['escalate', false], ['integrate', true], ['plan', true]]);
});

test('approved integrations show the recorded local commit and keep free text out of the map', () => {
  const commit = 'a'.repeat(40);
  const view = projectWorkflow({
    runs: [{runId: 'r', lastSeq: 2}],
    gates: [
      {runId: 'r', gateId: 'g', kind: 'integrate', status: 'approved', sha: commit, resolvedBy: 'lead', leadDecision: true},
      {runId: 'r', gateId: 'p', kind: 'plan', status: 'approved', sha: commit},
    ],
    events: [{runId: 'r', seq: 1, kind: 'integrate.committed', sha: commit},
      {runId: 'r', seq: 2, kind: 'worker.message', text: 'private text'}],
  }).runs[0];
  const gate = view.nodes.find(n => n.gateId === 'g');
  assert.equal(gate.subtitle, 'Approved by the lead');
  assert.deepEqual(gate.details, [{label: 'Local commit', value: commit}]);
  assert.deepEqual(view.nodes.find(n => n.gateId === 'p').details, []);
  assert.ok(view.activity.some(item => item.label.includes(commit.slice(0, 10))));
  assert.ok(!JSON.stringify(view).includes('private text'));
});

test('projects fresh snapshot, typed links and human-readable titles without prose', () => {
  const snapshot = {
    runs: [
      { runId: 'r1', task: { title: 'Déployer / review: #1!' }, status: 'running', lastSeq: 10 },
      { runId: 'r2', task: { title: 'Review' }, status: 'done', lastSeq: 1 },
    ],
    agents: [
      {
        runId: 'r1',
        agentId: 'a',
        role: 'builder',
        processState: 'running',
        provider: 'claude',
        model: 'opus',
        turnState: 'building',
      },
      { runId: 'r1', agentId: 'b', role: 'reviewer', processState: 'idle' },
    ],
    attempts: [
      {
        runId: 'r1',
        agentId: 'a',
        attemptId: 't1',
        kind: 'fresh',
        status: 'succeeded',
        dir: '/secret',
      },
      { runId: 'r1', agentId: 'a', attemptId: 't2', kind: 'resume', status: 'running' },
    ],
    gates: [{ runId: 'r1', gateId: 'g', kind: 'plan', status: 'pending', summary: 'secret' }],
  };
  const events = [
    { runId: 'r1', seq: 1, kind: 'agent.created', agentId: 'b', parentAgentId: 'a' },
    { runId: 'r1', seq: 2, kind: 'run.delegated', delegatedRunId: 'r2', target: 'worker' },
    { runId: 'r1', seq: 3, kind: 'plan.item', itemId: 'item', itemRunId: 'r2' },
    { runId: 'r1', seq: 5, kind: 'review.verdict', builderAttemptId: 't1', attemptId: 't2' },
    { runId: 'r1', seq: 4, kind: 'run.status', status: 'failed', reason: 'secret' },
    { runId: 'r1', seq: 11, kind: 'run.delegated', delegatedRunId: 'r2', target: 'plan' },
  ];
  const projection = projectWorkflow(snapshot, events);
  const run = projection.runs[0];
  assert.equal(run.title, 'Déployer / review: #1!');
  assert.equal(run.status, 'running');
  assert.equal(run.nodes.find((node) => node.id === 'gate:g').gateKind, 'plan');
  assert.equal(run.nodes.filter((node) => node.kind === 'attempt').length, 2);
  assert.ok(
    run.edges.some(
      (edge) => edge.from === 'agent:a' && edge.to === 'agent:b' && edge.kind === 'delegation',
    ),
  );
  assert.equal(run.nodes.filter((node) => node.kind === 'delegation').length, 2);
  assert.ok(!JSON.stringify(projection).includes('secret'));
  assert.equal(run.activity[0].id, 'r1:5');
  assert.ok(
    run.edges.some(
      (edge) => edge.from === 'attempt:t1' && edge.to === 'attempt:t2' && edge.kind === 'evidence',
    ),
  );
});

test('reserves pending decisions and current attempts when the graph is large', () => {
  const projection = projectWorkflow({
    runs: [
      {
        runId: 'r',
        task: { title: 'Lead conversation', description: 'private prompt' },
        status: 'new',
      },
    ],
    agents: Array.from({ length: 300 }, (_, i) => ({ runId: 'r', agentId: `a${i}` })),
    attempts: [{ runId: 'r', agentId: 'a0', attemptId: 'latest', status: 'running' }],
    gates: [{ runId: 'r', gateId: 'g', kind: 'plan', status: 'pending' }],
  });
  const run = projection.runs[0];
  assert.equal(run.nodes.length, 250);
  assert.ok(run.omitted > 0);
  assert.ok(run.nodes.some((node) => node.id === 'gate:g'));
  assert.ok(run.nodes.some((node) => node.id === 'attempt:latest'));
  assert.ok(!JSON.stringify(projection).includes('private prompt'));
});

test('a synthetic daemon snapshot retains identities, times and safe activity', () => {
  const runId = '11111111-1111-4111-8111-111111111111';
  const agentId = '22222222-2222-4222-8222-222222222222';
  const attemptId = '33333333-3333-4333-8333-333333333333';
  const fixture = {
    runs: [{ runId, createdAt: '2026-01-01T00:00:00Z', lastSeq: 1,
      task: { title: 'Lead conversation', description: 'private task text' } }],
    agents: [{ runId, agentId, role: 'lead', processState: 'idle' }],
    attempts: [{ runId, agentId, attemptId, startedAt: '2026-01-01T00:00:01Z' }],
    events: [{ runId, seq: 1, kind: 'loop.state', state: 'building' }],
  };
  const projection = projectWorkflow(fixture);
  assert.equal(projection.runs.length, 1);
  const lead = projection.runs[0];
  assert.ok(lead.createdAt);
  const attempt = lead.nodes.find((node) => node.kind === 'attempt');
  assert.ok(attempt.details.some((detail) => detail.label === 'Attempt ID' && detail.value === attemptId));
  assert.ok(attempt.details.some((detail) => detail.label === 'Started'));
  assert.ok(!JSON.stringify(projection).includes('private task text'));
  assert.ok(lead.activity.some((item) => item.label.startsWith('Workflow stage:')));
});

test('delegation uses visible target status and latest plan target', () => {
  const runs = [
    { runId: 'source', task: { title: 'Source' }, status: 'running', lastSeq: 5 },
    { runId: 'old', task: { title: 'Old' }, status: 'done' },
    { runId: 'new', task: { title: 'New task' }, status: 'running' },
  ];
  const events = [
    { runId: 'source', seq: 1, kind: 'plan.item', itemId: 'i', itemRunId: 'old' },
    { runId: 'source', seq: 2, kind: 'plan.item', itemId: 'i', itemRunId: 'new' },
    { runId: 'source', seq: 3, kind: 'plan.item', itemId: 'i', status: 'done' },
    { runId: 'source', seq: 4, kind: 'run.delegated', delegatedRunId: 'source' },
    { runId: 'source', seq: 5, kind: 'run.delegated', delegatedRunId: 'missing' },
  ];
  const source = projectWorkflow({ runs }, events).runs.find((run) => run.id === 'source');
  const links = source.nodes.filter((node) => node.kind === 'delegation');
  assert.equal(links.length, 1);
  assert.equal(links[0].targetRunId, 'new');
  assert.equal(links[0].title, 'New task');
  assert.equal(links[0].status, 'running');
});

test('does not link to a run beyond the cap', () => {
  const runs = Array.from({ length: 102 }, (_, i) => ({
    runId: `r${String(i).padStart(3, '0')}`,
    task: { title: 'Task' },
    status: i === 0 ? 'running' : 'done',
    lastSeq: 1,
  }));
  const p = projectWorkflow({ runs }, [
    { runId: 'r000', seq: 1, kind: 'run.delegated', delegatedRunId: 'r101' },
  ]);
  assert.equal(p.runs.length, 100);
  assert.ok(
    !p.runs.find((run) => run.id === 'r000').nodes.some((node) => node.targetRunId === 'r101'),
  );
});

test('gate records identify both run models and distinguish unresolved aliases', () => {
  const runId = 'child';
  const snapshot = {runs: [{runId:'parent'}, {runId, execution:{leadOwnerRunId:'parent'}, steps:{review:false}}],
    agents: [{runId:'parent',agentId:'l',role:'lead',provider:'claude',model:'opus'},
      {runId,agentId:'b',role:'builder',provider:'claude',model:'sonnet'}],
    attempts: [{runId:'parent',agentId:'l',attemptId:'one'}, {runId,agentId:'b',attemptId:'two'}],
    gates: [{runId, gateId:'g', kind:'integrate', status:'approved', resolvedBy:'lead', leadDecision:true}]};
  const models = new Map([['parent/one','claude-opus-5-5'],['child/two','claude-sonnet-5-5']]);
  const details = () => Object.fromEntries(projectWorkflow(snapshot, [], models).runs.find(r => r.id === runId)
    .nodes.find(n => n.kind === 'gate').details.map(d => [d.label,d.value]));
  assert.deepEqual(details(), {'Run lead':'Claude Opus 5.5','Run builder':'Claude Sonnet 5.5','Separate reviewer':'Not selected'});
  models.clear();
  assert.equal(details()['Run builder'], 'Claude Sonnet (configured alias)');
});
