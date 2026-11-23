export function conversationTarget(runs, currentRunId, edge, fromNode, toNode) {
  if (toNode?.workerAgentId && edge.kind === "delegation" && fromNode?.role === "lead") {
    const run = runs.find((item) => item.id === toNode.targetRunId);
    const worker = run?.nodes.find((node) => node.kind === "agent" && node.agentId === toNode.workerAgentId);
    if (worker) return { runId: run.id, worker };
  }
  if (toNode?.kind === "agent" && toNode.role !== "lead" &&
      ((edge.kind === "delegation" && fromNode?.role === "lead") || edge.kind === "membership")) {
    return { runId: currentRunId, worker: toNode };
  }
  return null;
}

export function exampleDecisionOutcome(decision) {
  return decision === "deny"
    ? {
        title: "Integration denied",
        status: "denied",
        consequence: "Changes remain unintegrated · example only",
      }
    : {
        title: "Integration approved",
        status: "approved",
        consequence: "Changes integrated · example only",
      };
}
export function decisionPayload(gate, decision, feedback) {
  const payload = { decision, runId: gate.runId };
  if (gate.diffHash) payload.diffHash = gate.diffHash;
  if (decision === "deny" && feedback) payload.feedback = feedback;
  return payload;
}
export function definitiveRejection(error) {
  return (
    Number.isInteger(error.status) && error.status >= 400 && error.status < 500
  );
}

export function statusLabel(status) {
  if (status === "awaiting_gate" || status === "waiting_for_approval")
    return "Awaiting approval";
  return String(status || "unknown").replaceAll("_", " ");
}

// Kahn ordering uses only recorded edges. Stage and ID make independent branches stable.
export function orderWorkflow(nodes, edges) {
  const stages = { run: 0, agent: 1, delegation: 1, attempt: 2, gate: 3 };
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const seen = new Set();
  for (const edge of edges) {
    const key = JSON.stringify([edge.from, edge.to]);
    if (!byId.has(edge.from) || !byId.has(edge.to) || seen.has(key)) continue;
    seen.add(key);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const compare = (a, b) =>
    (stages[a.kind] ?? 2) - (stages[b.kind] ?? 2) || a.id.localeCompare(b.id);
  const ready = nodes.filter((node) => incoming.get(node.id) === 0);
  const ordered = [];
  while (ready.length) {
    ready.sort(compare);
    const node = ready.shift();
    ordered.push(node);
    for (const target of outgoing.get(node.id)) {
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) ready.push(byId.get(target));
    }
  }
  const included = new Set(ordered.map((node) => node.id));
  return ordered.concat(
    nodes.filter((node) => !included.has(node.id)).sort(compare),
  );
}
