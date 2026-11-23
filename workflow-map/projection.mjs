// Only selected, bounded fields cross the browser boundary. Event prose is never projected.
const array = (value) => (Array.isArray(value) ? value : []);
const identifier = (value) =>
  typeof value === 'string' && /^[\w-]{1,100}$/.test(value) ? value : null;
const typed = (value, fallback = 'Unknown') =>
  typeof value === 'string' && /^[\w .+-]{1,100}$/.test(value) ? value : fallback;
const plain = (value, fallback = 'Task') =>
  typeof value === 'string' && value.trim()
    ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' '))
        .slice(0, 160)
        .join('')
    : fallback;
const nodeId = (kind, id) => `${kind}:${id}`;
const gitObjectId = (value) =>
  typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ? value : null;
const decisionActor = (actor, leadDecision) => leadDecision === true ? 'Lead' : actor === 'mcp' ? 'MCP' : actor ? 'Human' : 'Decision';
const newest = (a, b) =>
  (b.startedAt || b.createdAt || b.lastActivityAt || '').localeCompare(
    a.startedAt || a.createdAt || a.lastActivityAt || '',
  ) ||
  String(a.attemptId || a.agentId || a.gateId).localeCompare(
    String(b.attemptId || b.agentId || b.gateId),
  );

function groupByRun(rows, idField) {
  const groups = new Map();
  for (const row of array(rows)) {
    if (!identifier(row?.runId) || (idField && !identifier(row[idField]))) continue;
    if (!groups.has(row.runId)) groups.set(row.runId, []);
    groups.get(row.runId).push(row);
  }
  return groups;
}

function activityLabel(event, agents, attempts) {
  const attempt = attempts.get(event.attemptId);
  const agent = agents.get(event.agentId || attempt?.agentId);
  const actor = agent ? typed(agent.role, 'Agent') : 'Agent';
  switch (event.kind) {
    case 'run.created':
      return 'Task created';
    case 'run.status':
      return `Task status: ${typed(event.status)}`;
    case 'loop.state':
      return `Workflow stage: ${typed(event.state)}`;
    case 'agent.progress':
      return `${actor} reported progress`;
    case 'agent.created':
      return `${actor} joined the task`;
    case 'agent.status':
      return `${actor} status: ${typed(event.status)}`;
    case 'attempt.started':
      return `${actor} started an attempt`;
    case 'attempt.finished':
      return `${actor} finished an attempt: ${typed(event.status)}`;
    case 'gate.created':
      return 'Decision requested';
    case 'run.lead_authorized':
      return 'Lead decisions enabled for this run';
    case 'worker.message':
      return `${event.followup ? 'Follow-up' : 'Task'} sent to ${actor}`;
    case 'gate.resolving':
      return `${decisionActor(event.by, event.leadDecision)} resolving`;
    case 'gate.resolved':
      return `Decision: ${typed(event.status)}`;
    case 'run.delegated':
      return 'Work delegated to another task';
    case 'plan.item':
      return `Plan item: ${typed(event.status)}`;
    case 'plan.created':
      return 'Plan created';
    case 'diff.frozen':
      return 'Review evidence frozen';
    case 'review.verdict':
      return `Review verdict: ${typed(event.verdict)}`;
    case 'verify.report':
      return `Verification: ${typed(event.status)}`;
    case 'security.verdict':
      return `Security verdict: ${typed(event.verdict)}`;
    case 'integrate.committed':
      return gitObjectId(event.sha) ? `Local commit ${event.sha.slice(0, 10)} created` : 'Changes integrated';
    case 'run.recovered':
      return 'Task recovered';
    default:
      return null;
  }
}

export function projectWorkflow(snapshot = {}, events = []) {
  const runs = array(snapshot.runs).filter((run) => identifier(run?.runId));
  const agentsByRun = groupByRun(snapshot.agents, 'agentId');
  const attemptsByRun = groupByRun(snapshot.attempts, 'attemptId');
  const gatesByRun = groupByRun(snapshot.gates, 'gateId');
  const rank = (run) =>
    (gatesByRun.get(run.runId) || []).some((g) => g.status === 'pending')
      ? 2
      : ['running', 'active'].includes(run.status)
        ? 1
        : 0;
  runs.sort(
    (a, b) =>
      rank(b) - rank(a) ||
      (b.createdAt || '').localeCompare(a.createdAt || '') ||
      a.runId.localeCompare(b.runId),
  );
  const visibleRuns = runs.slice(0, 100);
  const runMap = new Map(visibleRuns.map((run) => [run.runId, run]));
  const uniqueEvents = new Map();
  for (const event of [...array(snapshot.events), ...array(events)]) {
    if (identifier(event?.runId) && Number.isSafeInteger(event.seq) && event.seq >= 0) {
      uniqueEvents.set(`${event.runId}:${event.seq}`, event);
    }
  }
  const eventsByRun = groupByRun([...uniqueEvents.values()]);
  // Older snapshots omit relationship fields. Recover only from creation events belonging to
  // the same run and agent, bounded by that run's recorded sequence; never guess from another run.
  for (const run of visibleRuns) {
    if (!Number.isSafeInteger(run.lastSeq) || run.lastSeq < 0) continue;
    const created = new Map();
    for (const event of eventsByRun.get(run.runId) || []) {
      if (event.kind === 'agent.created' && event.seq <= run.lastSeq && identifier(event.agentId)
          && !created.has(event.agentId)) created.set(event.agentId, event);
    }
    const agents = agentsByRun.get(run.runId);
    if (!agents) continue;
    agentsByRun.set(run.runId, agents.map((agent) => {
      const event = created.get(agent.agentId);
      if (!event || event.role !== agent.role) return agent;
      return {
        ...agent,
        ...(!Object.hasOwn(agent, 'origin') && ['lead', 'control-plane'].includes(event.origin)
          ? { origin: event.origin } : {}),
        ...(!Object.hasOwn(agent, 'parentAgentId') && identifier(event.parentAgentId)
          ? { parentAgentId: event.parentAgentId } : {}),
      };
    }));
  }
  const projected = visibleRuns.map((run) => {
    const id = run.runId;
    const agents = [...(agentsByRun.get(id) || [])].sort(
      (a, b) =>
        Number(b.processState === 'running') - Number(a.processState === 'running') || newest(a, b),
    );
    const attempts = [...(attemptsByRun.get(id) || [])].sort(
      (a, b) => Number(b.status === 'running') - Number(a.status === 'running') || newest(a, b),
    );
    const gates = [...(gatesByRun.get(id) || [])].sort(
      (a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || newest(a, b),
    );
    const ownEvents = (eventsByRun.get(id) || [])
      .filter((event) => run.lastSeq == null || event.seq <= run.lastSeq)
      .sort((a, b) => a.seq - b.seq);
    const agentMap = new Map(agents.map((agent) => [agent.agentId, agent]));
    const attemptMap = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
    const nodes = [],
      edges = [],
      keys = new Set(),
      edgeKeys = new Set();
    let omitted = 0;
    function add(node) {
      if (keys.has(node.id)) return;
      if (nodes.length >= 250) {
        omitted++;
        return;
      }
      keys.add(node.id);
      nodes.push(node);
    }
    function edge(from, to, kind, label) {
      const key = `${from}\0${to}\0${kind}`;
      if (!keys.has(from) || !keys.has(to) || edgeKeys.has(key) || edges.length >= 500) return;
      edgeKeys.add(key);
      edges.push({ from, to, kind, label });
    }
    const title = plain(run.task?.title);
    const leadApproved = identifier(run.execution?.leadApprovalRunId) !== null;
    add({
      id: nodeId('run', id),
      kind: 'run',
      title,
      subtitle: 'Task',
      status: typed(run.status),
      leadApproved,
      canAuthorizeLead: !['cancelled', 'integrated', 'completed', 'failed'].includes(run.status)
        && run.execution?.mode !== 'audit'
        && (!run.execution?.leadOwnerRunId || run.execution.leadOwnerRunId === id)
        && (run.execution?.terminalLeadRequested === true || agents.some((a) => a.role === 'lead')),
      details: [{ label: 'Decision authority', value: identifier(run.execution?.leadApprovalRunId) ? 'Lead approved for this run' : 'Human approval by default' }],
    });
    // Reserve decisions first, then active agents and recent attempts.
    for (const gate of gates) {
      const kind = typed(gate.kind);
      const awaitingLead = gate.status === 'pending' && leadApproved && ['plan', 'integrate'].includes(kind);
      const sha = kind === 'integrate' && gate.status === 'approved' && gitObjectId(gate.sha);
      add({
        id: nodeId('gate', gate.gateId),
        kind: 'gate',
        gateId: gate.gateId,
        gateKind: kind,
        title: `${kind} decision`,
        awaitingLead,
        subtitle: gate.resolvedBy ? `${decisionActor(gate.resolvedBy, gate.leadDecision)} decision`
          : awaitingLead ? 'Waiting for the lead' : 'Decision',
        status: typed(gate.status),
        details: sha ? [{ label: 'Local commit', value: sha }] : [],
      });
      edge(nodeId('run', id), nodeId('gate', gate.gateId), 'decision', 'Decision');
    }
    const leads = agents.filter((agent) => agent.role === 'lead');
    const leadNode = leads.length === 1 ? nodeId('agent', leads[0].agentId) : null;
    const candidateCount = Math.max(agents.length, attempts.length);
    for (let index = 0; index < candidateCount; index++) {
      const agent = agents[index];
      if (agent) {
        const permissionWait = attempts.some((a) => a.agentId === agent.agentId && a.error?.code === 'native_permission_required');
        add({
          id: nodeId('agent', agent.agentId),
          kind: 'agent',
          agentId: agent.agentId,
          role: typed(agent.role, 'Agent'),
          title: typed(agent.role, 'Agent'),
          subtitle: 'Agent',
          status: permissionWait ? 'waiting_for_native_permission' : typed(agent.processState),
          details: [
            { label: 'Provider', value: typed(agent.provider) },
            { label: 'Model', value: typed(agent.model) },
            { label: 'Stage', value: typed(agent.turnState) },
            ...(permissionWait ? [{ label: 'Native access', value: 'A required action was denied or requested. Worker-specific grant verification is unavailable; this worker cannot resume.' }] : []),
          ],
        });
      }
      const attempt = attempts[index];
      if (attempt) {
        const role = typed(agentMap.get(attempt.agentId)?.role, 'Agent');
        add({
          id: nodeId('attempt', attempt.attemptId),
          kind: 'attempt',
          title: `${role} ${typed(attempt.kind, 'work')} attempt`,
          subtitle: `Attempt ${attempt.attemptId.slice(0, 8)}`,
          status: typed(attempt.status),
          details: [
            { label: 'Attempt ID', value: attempt.attemptId },
            { label: 'Kind', value: typed(attempt.kind) },
            ...(attempt.startedAt ? [{ label: 'Started', value: attempt.startedAt }] : []),
            ...(attempt.finishedAt ? [{ label: 'Finished', value: attempt.finishedAt }] : []),
          ],
        });
      }
    }
    for (const agent of agents) {
      const target = nodeId('agent', agent.agentId);
      const parent = identifier(agent.parentAgentId) ? nodeId('agent', agent.parentAgentId) : null;
      const source = parent || (agent.origin === 'lead' && agent.role !== 'lead' ? leadNode : null);
      if (source && keys.has(source)) edge(source, target, 'delegation', 'Delegated');
      else edge(nodeId('run', id), target, 'membership', agent.role === 'lead' ? 'Coordinates' : 'Member');
    }
    // Connect after adding all nodes, because a recent attempt's agent may be later in the list.
    for (const attempt of attempts)
      edge(
        nodeId('agent', attempt.agentId),
        nodeId('attempt', attempt.attemptId),
        'attempt',
        'Attempt',
      );
    const planTargets = new Map();
    for (const event of ownEvents) {
      if (event.kind === 'plan.item' && identifier(event.itemId) && identifier(event.itemRunId))
        planTargets.set(event.itemId, event.itemRunId);
    }
    for (const event of ownEvents) {
      if (
        ['review.verdict', 'verify.report', 'security.verdict'].includes(event.kind) &&
        identifier(event.builderAttemptId) &&
        identifier(event.attemptId)
      ) {
        edge(
          nodeId('attempt', event.builderAttemptId),
          nodeId('attempt', event.attemptId),
          'evidence',
          'Checked',
        );
      }
      if (
        event.kind === 'agent.created' &&
        identifier(event.agentId) &&
        identifier(event.parentAgentId)
      ) {
        edge(
          nodeId('agent', event.parentAgentId),
          nodeId('agent', event.agentId),
          'delegation',
          'Delegated',
        );
      }
      if (
        event.kind === 'run.delegated' &&
        identifier(event.delegatedRunId) &&
        event.delegatedRunId !== id &&
        runMap.has(event.delegatedRunId)
      ) {
        const target = nodeId('delegation', `run-${event.delegatedRunId}`);
        const workers = (agentsByRun.get(event.delegatedRunId) || []).filter((agent) =>
          event.target === 'worker' && agent.role === event.role && agent.origin === 'lead' && !agent.parentAgentId);

        add({
          id: target,
          kind: 'delegation',
          title: plain(runMap.get(event.delegatedRunId).task?.title),
          subtitle:
            event.target === 'plan' ? 'Delegated plan' : `Delegated ${typed(event.role, 'task')}`,
          status: typed(runMap.get(event.delegatedRunId).status),
          details: [],
          targetRunId: event.delegatedRunId,
          ...(workers.length === 1 ? { workerAgentId: workers[0].agentId, workerRole: typed(workers[0].role) } : {}),
        });
        edge(leadNode && keys.has(leadNode) ? leadNode : nodeId('run', id), target, 'delegation', 'Delegated');
      }
      if (event.kind === 'plan.item' && identifier(event.itemId)) {
        if (
          identifier(event.itemRunId) &&
          planTargets.get(event.itemId) === event.itemRunId &&
          event.itemRunId !== id &&
          runMap.has(event.itemRunId)
        ) {
          const target = nodeId('delegation', `plan-${event.itemId}`);
          add({
            id: target,
            kind: 'delegation',
            title: plain(runMap.get(event.itemRunId).task?.title),
            subtitle: `Plan item ${typed(event.itemId)}`,
            status: typed(runMap.get(event.itemRunId).status),
            details: [],
            targetRunId: event.itemRunId,
          });
          edge(nodeId('run', id), target, 'plan', 'Plan item');
        }
        if (identifier(event.gateId))
          edge(nodeId('run', id), nodeId('gate', event.gateId), 'plan', 'Plan decision');
      }
    }
    const activity = ownEvents
      .map((event) => ({ event, label: activityLabel(event, agentMap, attemptMap) }))
      .filter((item) => item.label)
      .slice(-40)
      .reverse()
      .map(({ event, label }) => {
        const target =
          ['gate', 'attempt', 'agent']
            .map((kind) => nodeId(kind, event[`${kind}Id`]))
            .find((key) => keys.has(key)) || nodeId('run', id);
        return {
          id: `${id}:${event.seq}`,
          label,
          at: typeof event.ts === 'string' ? event.ts.slice(0, 40) : '',
          nodeId: target,
        };
      });
    return {
      id,
      title,
      lastSeq: Number.isSafeInteger(run.lastSeq) ? run.lastSeq : 0,
      createdAt: typeof run.createdAt === 'string' ? run.createdAt : '',
      status: typed(run.status),
      nodes,
      edges,
      activity,
      omitted,
      _attention: gates.some((gate) => gate.status === 'pending') ? 1 : 0,
      _time: typeof run.createdAt === 'string' ? run.createdAt : '',
    };
  });
  return { runs: projected.slice(0, 100).map(({ _attention, _time, ...run }) => run) };
}
