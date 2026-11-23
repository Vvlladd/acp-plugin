import test from "node:test";
import assert from "node:assert/strict";
import * as context from "../public/workflow-ui.mjs";
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a lead-to-child edge opens the child run conversation', () => {
  const worker = { kind: 'agent', id: 'agent:worker', role: 'builder', agentId: 'worker' };
  const runs = [{ id: 'child', nodes: [worker] }];
  const target = context.conversationTarget(runs, 'root', { kind: 'delegation' },
    { role: 'lead' }, { targetRunId: 'child', workerAgentId: 'worker' });
  assert.deepEqual(target, { runId: 'child', worker });
  assert.equal(context.conversationTarget(runs, 'root', { kind: 'delegation' },
    { role: 'builder' }, { targetRunId: 'child', workerAgentId: 'worker' }), null);
  assert.equal(context.conversationTarget([], 'root', { kind: 'delegation' },
    { role: 'lead' }, { targetRunId: 'child', workerAgentId: 'worker' }), null);
  assert.deepEqual(context.conversationTarget(runs, 'root', { kind: 'delegation' },
    { role: 'lead' }, worker), { runId: 'root', worker });
});

test("approval has exact identity and digest, never denial feedback", () => {
  assert.deepEqual(
    plain(
      context.decisionPayload(
        { runId: "run-1", diffHash: "hash" },
        "approve",
        "hidden input text",
      ),
    ),
    {
      decision: "approve",
      runId: "run-1",
      diffHash: "hash",
    },
  );
});
test("denial includes optional feedback only when supplied", () => {
  assert.deepEqual(
    plain(context.decisionPayload({ runId: "run-1" }, "deny", "Please revise")),
    {
      decision: "deny",
      runId: "run-1",
      feedback: "Please revise",
    },
  );
  assert.deepEqual(
    plain(context.decisionPayload({ runId: "run-1" }, "deny", "")),
    {
      decision: "deny",
      runId: "run-1",
    },
  );
});
test("definitive client rejection can refresh; lost or server response remains uncertain", () => {
  for (const status of [400, 401, 403, 404, 409, 422, 429])
    assert.equal(context.definitiveRejection({ status }), true);
  for (const status of [undefined, 0, 500, 503])
    assert.equal(context.definitiveRejection({ status }), false);
});
test("example denial and approval have distinct truthful outcomes", () => {
  assert.match(context.exampleDecisionOutcome("deny").title, /denied/);
  assert.match(
    context.exampleDecisionOutcome("deny").consequence,
    /remain unintegrated/,
  );
  assert.match(context.exampleDecisionOutcome("approve").title, /approved/);
  assert.match(
    context.exampleDecisionOutcome("approve").consequence,
    /Changes integrated/,
  );
});

test("gate-first projection lays out by actual dependencies, not array order", () => {
  const nodes = [
    { id: "gate:g", kind: "gate" },
    { id: "attempt:a", kind: "attempt" },
    { id: "agent:b", kind: "agent" },
    { id: "run:r", kind: "run" },
  ];
  const edges = [
    { from: "run:r", to: "agent:b" },
    { from: "agent:b", to: "attempt:a" },
    { from: "attempt:a", to: "gate:g" },
  ];
  assert.deepEqual(
    context.orderWorkflow(nodes, edges).map((n) => n.id),
    ["run:r", "agent:b", "attempt:a", "gate:g"],
  );
  assert.deepEqual(
    context.orderWorkflow([...nodes].reverse(), edges).map((n) => n.id),
    ["run:r", "agent:b", "attempt:a", "gate:g"],
  );
});
test("unconnected gate follows work and cyclic input retains every identity", () => {
  const nodes = [
    { id: "g", kind: "gate" },
    { id: "a", kind: "agent" },
    { id: "r", kind: "run" },
  ];
  assert.deepEqual(
    context.orderWorkflow(nodes, []).map((n) => n.id),
    ["r", "a", "g"],
  );
  assert.equal(
    new Set(
      context
        .orderWorkflow(nodes, [
          { from: "a", to: "g" },
          { from: "g", to: "a" },
        ])
        .map((n) => n.id),
    ).size,
    3,
  );
});
test("demo decisions publish distinct actual statuses and readable gate wait", () => {
  assert.equal(context.exampleDecisionOutcome("deny").status, "denied");
  assert.equal(context.exampleDecisionOutcome("approve").status, "approved");
  assert.equal(context.statusLabel("awaiting_gate"), "Awaiting approval");
});

test("gate controls require a pending decision in both the map and the fresh evidence", () => {
  const pending = {status:"pending"};
  assert.equal(context.gatePresentation(pending, pending), "human");
  assert.equal(context.gatePresentation({...pending, awaitingLead:true}, pending), "lead");
  for (const status of ["approved", "denied", "resolving", "queued"]) {
    assert.equal(context.gatePresentation({status}, pending), "recorded");
    assert.equal(context.gatePresentation(pending, {status}), "recorded");
  }
});
