import {
  exampleDecisionOutcome,
  decisionPayload,
  definitiveRejection,
  orderWorkflow,
  statusLabel,
  conversationTarget,
  gatePresentation,
} from "./workflow-ui.mjs";
("use strict");
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
};
let live = {
    connection: "connecting",
    runs: [],
    updatedAt: null,
  },
  demo = false,
  playing = true,
  tick = 0,
  selected = null,
  runId = null,
  camera = {
    x: 45,
    y: 130,
    z: 1,
  },
  positions = new Map(),
  gateEpoch = 0,
  pending = null,
  uncertain = new Set(),
  source;
let demoDecision = null;
let demoLeadApproved = false;
let conversation = null;
const active = (s) =>
  /running|active|working|started|in_progress/.test(s || "");
const waiting = (s) => /pending|waiting|approval|blocked/.test(s || "");
let auth = {};
try {
  auth = JSON.parse(sessionStorage.getItem("acp-workflow-session") || "{}");
} catch {}
const state = () => (demo ? example() : live);
const run = () => state().runs.find((r) => r.id === runId) || state().runs[0];
const statusClass = (s) => (waiting(s) ? "wait" : active(s) ? "" : "quiet");
function example() {
  const phase = Math.min(3, Math.floor(tick / 4));
  return {
    connection: "example",
    updatedAt: new Date().toISOString(),
    runs: [
      {
        id: "example-run",
        lastSeq: phase + 1,
        title: "Build a clearer first-run experience",
        status:
          tick >= 16
            ? "completed"
            : phase === 3
              ? "waiting_for_approval"
              : "running",
        omitted: 0,
        nodes: [
          {
            id: "run:example",
            kind: "run",
            title: "First-run experience",
            subtitle: "Human request · product workflow",
            status:
              tick >= 16
                ? "completed"
                : phase === 3
                  ? "waiting_for_approval"
                  : "running",
            details: [
              {
                label: "Run",
                value: "example-run",
              },
              {
                label: "Scope",
                value: "Illustrative browser-only replay",
              },
            ],
          },
          {
            id: "agent:lead",
            role: "lead",
            kind: "agent",
            title: "Lead · coordinate the work",
            subtitle: "Delegates implementation and checks",
            status:
              tick >= 16
                ? "completed"
                : phase === 3
                  ? "waiting_for_approval"
                  : "running",
            details: [
              {
                label: "Role",
                value: "Lead",
              },
              {
                label: "Provider / model",
                value: "Example provider · illustrative model",
              },
            ],
          },
          {
            id: "agent:builder",
            kind: "agent",
            agentId: "example-builder",
            role: "builder",
            title: "Builder · implement",
            subtitle: `Isolated worktree · attempt ${phase < 1 ? 1 : 2}`,
            status: phase >= 2 ? "completed" : "running",
            details: [
              {
                label: "Role",
                value: "Builder",
              },
              {
                label: "Outcome",
                value: "Prepared changes for independent verification",
              },
            ],
          },
          {
            id: "attempt:verify",
            kind: "attempt",
            title: "Verifier · check the change",
            subtitle: "Tests and acceptance checks",
            status:
              phase === 0 ? "queued" : phase > 1 ? "completed" : "running",
            details: [
              {
                label: "Attempt",
                value: "verify-1",
              },
              {
                label: "Evidence",
                value: "Example checks only; no real tests run",
              },
            ],
          },
          {
            id: "delegation:review",
            kind: "delegation",
            title: "Review accessibility",
            subtitle: "A separate delegated run",
            status: phase > 1 ? "completed" : "running",
            targetRunId: "example-review",
            details: [
              {
                label: "Relationship",
                value: "Lead delegated an independent review",
              },
            ],
          },
          {
            id: "gate:demo",
            kind: "gate",
            title:
              tick >= 16
                ? (demoDecision === "lead" ? "Lead approved integration" : exampleDecisionOutcome(demoDecision).title)
                : phase === 3
                  ? "Your decision · integrate"
                  : "Integration decision",
            subtitle:
              tick >= 16
                ? exampleDecisionOutcome(demoDecision).consequence
                : phase === 3
                  ? "Review evidence before approval"
                  : "Available after checks complete",
            status:
              tick >= 16
                ? exampleDecisionOutcome(demoDecision).status
                : phase === 3
                  ? "pending"
                  : "queued",
            gateId: "example-gate",
            gateKind: "integrate",
            details: [
              {
                label: "Gate",
                value: "example-gate",
              },
              {
                label: "Consequence",
                value: "Simulates integration in this browser only",
              },
            ],
          },
        ],
        edges: [
          {
            from: "run:example",
            to: "agent:lead",
            label: "coordinates",
            kind: "membership",
          },
          {
            from: "agent:lead",
            to: "agent:builder",
            label: "delegates build",
            kind: "delegation",
          },
          {
            from: "agent:builder",
            to: "attempt:verify",
            label: "hands off to checks",
            kind: "handoff",
          },
          {
            from: "agent:lead",
            to: "delegation:review",
            label: "delegates review",
            kind: "delegation",
          },
          {
            from: "attempt:verify",
            to: "gate:demo",
            label: "evidence for decision",
            kind: "gate",
          },
          {
            from: "delegation:review",
            to: "gate:demo",
            label: "review informs",
            kind: "gate",
          },
        ],
        activity: [
          {
            id: "e" + phase,
            label:
              tick >= 16
                ? demoDecision === "deny"
                  ? "Human denied integration · example complete"
                  : demoDecision === "lead" ? "Lead approved the verified local commit · example complete" : "Human approved integration · example complete"
                : phase === 3
                  ? "Checks complete · waiting for your decision"
                  : phase === 2
                    ? "Builder returned the revision · selected checks passed"
                    : phase === 1
                      ? "Review requested a keyboard fix · builder is revising"
                      : "Lead delegated implementation and review",
            at: new Date().toISOString(),
          },
        ],
      },
      {
        id: "example-review",
        title: "Review accessibility",
        status: "completed",
        nodes: [
          {
            id: "run:review",
            kind: "run",
            title: "Accessibility review",
            subtitle: "Delegated by First-run experience",
            status: "completed",
            details: [
              {
                label: "Parent run",
                value: "example-run",
              },
            ],
            targetRunId: "example-run",
          },
          {
            id: "agent:reviewer",
            kind: "agent",
            title: "Reviewer · inspect",
            subtitle: "Independent review complete",
            status: "completed",
            details: [
              {
                label: "Result",
                value: "Example review: ready for human inspection",
              },
            ],
          },
        ],
        edges: [
          {
            from: "run:review",
            to: "agent:reviewer",
            kind: "membership",
            label: "assigned reviewer",
          },
        ],
        activity: [],
        omitted: 0,
      },
    ],
  };
}
function applyCamera() {
  $("world").style.transform =
    `translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;
  $("zoomLabel").textContent = Math.round(camera.z * 100) + "%";
}
const heights = new Map();
let restoringFocus = false;
function layout(r) {
  positions = new Map();
  const width = $("canvas").clientWidth;
  const columns = width < 650 ? 1 : width < 1000 ? 2 : 3;
  const rowHeights = [];
  orderWorkflow(r.nodes, r.edges).forEach((node, index) => {
    const row = Math.floor(index / columns);
    let column = index % columns;
    if (row % 2) column = columns - 1 - column;
    rowHeights[row] = Math.max(
      rowHeights[row] || 145,
      heights.get(node.id) || 145,
    );
    positions.set(node.id, { x: column * 350, row, y: row * 238 });
  });
  const rows = new Map();
  for (const [id, point] of positions) {
    if (!rows.has(point.row)) rows.set(point.row, []);
    rows.get(point.row).push(id);
  }
  function permutations(values) {
    if (values.length < 2) return [values];
    return values.flatMap((value, i) =>
      permutations(values.filter((_, j) => j !== i)).map((rest) => [
        value,
        ...rest,
      ]),
    );
  }
  for (const [row, ids] of rows) {
    if (row === 0 || ids.length < 2) continue;
    const slots = ids.map((id) => positions.get(id).x).sort((a, b) => a - b);
    let best = ids,
      score = Infinity;
    for (const candidate of permutations(ids)) {
      let cost = 0;
      candidate.forEach((id, i) => {
        for (const edge of r.edges) {
          const parent = positions.get(edge.from);
          if (edge.to === id && parent && parent.row < row)
            cost += Math.abs(parent.x - slots[i]);
        }
      });
      if (cost < score) {
        score = cost;
        best = candidate;
      }
    }
    best.forEach((id, i) => (positions.get(id).x = slots[i]));
  }
  for (const point of positions.values())
    point.y = rowHeights
      .slice(0, point.row)
      .reduce((sum, h) => sum + h + 93, 0);
}
function fit() {
  if (!run()?.nodes.length) return;
  const points = [...positions.values()];
  const width = Math.max(...points.map((p) => p.x)) + 252;
  const height = Math.max(...points.map((p) => p.y)) + 145;
  const box = $("canvas").getBoundingClientRect();
  // Keep text readable; large workflows deliberately extend beyond the viewport.
  camera.z = Math.min(
    1,
    Math.max(
      0.95,
      Math.min((box.width - 60) / width, (box.height - 220) / height),
    ),
  );
  camera.x = Math.max(25, (box.width - width * camera.z) / 2);
  camera.y = 150 + Math.max(0, (box.height - 225 - height * camera.z) / 2);
  $("canvas").scrollTop = 0;
  $("canvas").scrollLeft = 0;
  applyCamera();
}
function render(reset = false) {
  const focusedNode = document.activeElement?.dataset?.nodeId;
  const focusedEdge = document.activeElement?.dataset?.edgeKey;
  const s = state(),
    r = run();
  if (r) runId = r.id;
  $("connection").textContent = demo
    ? "Example replay"
    : s.connection === "live"
      ? "Connection live"
      : s.connection === "connecting"
        ? "Connecting"
        : "Offline";
  $("connection").className = "connection " + (demo ? "example" : s.connection);
  $("exampleBar").hidden = !demo;
  $("example").hidden = demo;
  $("notice").hidden = demo;
  $("notice").textContent =
    s.connection === "live"
      ? `Observing ACP · updated ${s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString() : "just now"}`
      : (s.message ||
          "ACP is unavailable. Open the paired launch link, or explore the example.") +
        (s.updatedAt
          ? " Last known state: " + new Date(s.updatedAt).toLocaleString()
          : "");
  $("runs").replaceChildren(
    ...s.runs.map((x) => {
      const o = el(
        "option",
        `${x.title || "Untitled run"}${demo ? "" : " · " + x.id.slice(0, 8)}${x.createdAt ? " · " + new Date(x.createdAt).toLocaleDateString() : ""}`,
      );
      o.value = x.id;
      return o;
    }),
  );
  $("runs").value = runId || "";
  $("runs").disabled = !s.runs.length;
  $("empty").hidden = !!r?.nodes?.length;
  $("emptyTitle").textContent = s.connection === "live" ? "No runs yet" : "Connect to see your workflow";
  $("emptyText").textContent = s.connection === "live"
    ? "ACP is connected. Runs and handoffs will appear here when work starts."
    : "Pair this browser using the local launch URL. When ACP is available, your runs and handoffs appear here.";
  $("nodes").replaceChildren();
  $("lines").replaceChildren();
  $("runSummary").replaceChildren();
  $("activity").replaceChildren();
  if (!r) {
    selected = null;
    inspect();
    return;
  }
  const sum = el("div", null, "summary");
  const activeAgents = r.nodes.filter(
    (n) => n.kind === "agent" && active(n.status),
  ).length;
  const activeAttempts = r.nodes.filter(
    (n) => n.kind === "attempt" && active(n.status),
  ).length;
  sum.append(
    el("strong", activeAgents),
    el("p", `active agents · ${activeAttempts} active attempts`),
  );
  sum.setAttribute("role", "group");
  sum.setAttribute(
    "aria-label",
    `${activeAgents} active agents and ${activeAttempts} active attempts. Run status: ${statusLabel(r.status)}`,
  );
  for (const [a, b] of [
    ["Status", statusLabel(r.status)],
    [
      "Needs attention",
      r.nodes.filter((n) => n.kind === "gate" && waiting(n.status)).length,
    ],
    ["Visible cards", r.nodes.length],
  ]) {
    const row = el("div", null, "stat");
    row.append(el("span", a), el("span", b));
    sum.append(row);
  }
  if (r.omitted)
    sum.append(
      el(
        "p",
        `${r.omitted} additional records omitted. This is a bounded view.`,
      ),
    );
  $("runSummary").append(sum);
  layout(r);
  for (const n of r.nodes) {
    const p = positions.get(n.id),
      b = el("button", null, "node" + (n.id === selected ? " selected" : ""));
    b.dataset.kind = n.kind;
    b.dataset.nodeId = n.id;
    if (n.kind === "gate" && waiting(n.status))
      b.classList.add("needs-attention");
    b.style.left = p.x + "px";
    b.style.top = p.y + "px";
    b.setAttribute("aria-label", `${n.kind}: ${n.title}, ${n.status}`);
    const type = el("span", null, "type");
    type.append(
      el("span", n.kind),
      el("span", statusLabel(n.status), "status " + statusClass(n.status)),
    );
    b.append(
      type,
      el("span", n.title, "node-title"),
      el(
        "span",
        n.kind === "agent" && !demo
          ? n.details.find(d => d.label === "Model")?.value || n.subtitle
          : [n.subtitle, ...(n.details || []).filter(d => /provider|model/i.test(d.label)).map(d => d.value)]
              .filter(Boolean).join(" · "),
        "subtitle",
      ),
    );
    if (n.kind === "gate" && waiting(n.status))
      b.append(el("span", n.awaitingLead ? "Waiting for the lead" : "Review decision →", "gate-callout"));
    b.onclick = () => select(n.id);
    $("nodes").append(b);
  }
  for (const card of $("nodes").children)
    heights.set(card.dataset.nodeId, card.offsetHeight);
  layout(r);
  for (const card of $("nodes").children) {
    const point = positions.get(card.dataset.nodeId);
    card.style.left = point.x + "px";
    card.style.top = point.y + "px";
  }
  for (const [edgeIndex, e] of r.edges.entries()) {
    const a = positions.get(e.from),
      b = positions.get(e.to);
    if (!a || !b) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const sameRow = a.y === b.y;
    const forward = b.x > a.x;
    const x = sameRow ? a.x + (forward ? 252 : 0) : a.x + 126;
    const y = sameRow
      ? a.y + heights.get(e.from) / 2
      : a.y + heights.get(e.from);
    const tx = sameRow ? b.x + (forward ? 0 : 252) : b.x + 126;
    const ty = sameRow ? b.y + heights.get(e.to) / 2 : b.y;
    const bypass = sameRow && Math.abs(a.x - b.x) > 350;
    if (bypass) {
      const corridor = Math.max(a.y, b.y) + 191;
      path.setAttribute(
        "d",
        `M${a.x + 126} ${a.y + heights.get(e.from)} V${corridor} H${b.x + 126} V${b.y + heights.get(e.to)}`,
      );
    } else {
      path.setAttribute(
        "d",
        sameRow
          ? `M${x} ${y} C${x + (forward ? 35 : -35)} ${y},${tx + (forward ? -35 : 35)} ${ty},${tx} ${ty}`
          : `M${x} ${y} C${x} ${y + 42},${tx} ${ty - 42},${tx} ${ty}`,
      );
    }
    path.setAttribute(
      "class",
      "edge" +
        ((demo || live.connection === "live") &&
        active(r.nodes.find((n) => n.id === e.to)?.status)
          ? " flow"
          : ""),
    );
    const fromNode = r.nodes.find((n) => n.id === e.from);
    const toNode = r.nodes.find((n) => n.id === e.to);
    const target = conversationTarget(s.runs, runId, e, fromNode, toNode);
    const worker = target?.worker;
    const label = document.createElementNS(path.namespaceURI, "text");
    const diagonal = !sameRow && x !== tx;
    const labelX = sameRow || diagonal ? (x + tx) / 2 : x + 13;
    const labelY = bypass
      ? a.y + 183
      : sameRow || diagonal
        ? (y + ty) / 2 - 9
        : y + (ty - y) * (0.3 + (edgeIndex % 3) * 0.2);
    label.setAttribute("x", labelX);
    label.setAttribute("y", labelY);
    label.setAttribute("text-anchor", sameRow || diagonal ? "middle" : "start");
    label.setAttribute("class", "edge-label");
    const relation = e.label || e.kind;
    const freeWidth = bypass
      ? Math.abs(a.x - b.x) - 40
      : sameRow
        ? Math.abs(tx - x) - 14
        : 200;
    const maxCharacters = Math.max(6, Math.floor(freeWidth / 6.3));
    label.textContent =
      relation.length > maxCharacters
        ? relation.slice(0, maxCharacters - 1) + "…"
        : relation;
    const fullLabel = document.createElementNS(path.namespaceURI, "title");
    fullLabel.textContent = relation;
    label.append(fullLabel);
    const pathTitle = fullLabel.cloneNode(true);
    path.append(pathTitle);
    const link = document.createElementNS(path.namespaceURI, "g");
    link.append(path);
    if (path.classList.contains("flow") || worker?.agentId) {
      const pulse = document.createElementNS(path.namespaceURI, "path");
      pulse.setAttribute("class", "handoff-pulse");
      pulse.setAttribute("aria-hidden", "true");
      pulse.setAttribute("d", path.getAttribute("d"));
      pulse.setAttribute("pathLength", "100");
      link.append(pulse);
    }
    link.append(label);
    if (worker?.agentId) {
      link.setAttribute("class", "conversation-edge");
      link.dataset.edgeKey = JSON.stringify([e.from, e.to, e.kind]);
      link.classList.toggle("selected-edge", selected === worker.id);
      link.setAttribute("tabindex", "0");
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", `Open ${worker.title} conversation`);
      const hitArea = document.createElementNS(path.namespaceURI, "path");
      hitArea.setAttribute("d", path.getAttribute("d"));
      hitArea.setAttribute("class", "edge-hit-area");
      link.prepend(hitArea);
      const openConversation = () => {
        runId = target.runId;
        selectConversation(worker);
      };
      link.onclick = (event) => { event.stopPropagation(); openConversation(); };
      link.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openConversation();
        }
      };
    }
    $("lines").append(link);
  }
  for (const a of (r.activity || []).slice(0, 12)) {
    const li = el("li", a.label),
      t = el(
        "time",
        a.at ? new Date(a.at).toLocaleTimeString() : "Time unavailable",
      );
    li.append(t);
    if (a.nodeId) {
      li.tabIndex = 0;
      li.onclick = () => select(a.nodeId);
      li.onkeydown = (e) => {
        if (e.key === "Enter") select(a.nodeId);
      };
    }
    $("activity").append(li);
  }
  if (!r.activity?.length)
    $("activity").append(el("li", "No recent recorded activity."));
  $("activityCount").textContent = r.activity?.length || "";
  if (!r.nodes.some((n) => n.id === selected)) selected = null;
  inspect();
  if (focusedNode) {
    const card = [...$("nodes").children].find(
      (n) => n.dataset.nodeId === focusedNode,
    );
    restoringFocus = true;
    card?.focus({ preventScroll: true });
    restoringFocus = false;
  } else if (focusedEdge) {
    [...$("lines").children].find((link) => link.dataset.edgeKey === focusedEdge)
      ?.focus({ preventScroll: true });
  }
  updateAttention(r);
  if (reset) fit();
  else applyCamera();
}
function select(id) {
  selected = id;
  render();
}
function selectConversation(worker) {
  selected = worker.id;
  if (conversation?.runId !== runId || conversation.workerId !== worker.agentId) {
    const panel = el("section");
    const rows = el("div");
    const status = el("p");
    const more = el("button", "Load next messages");
    more.hidden = true;
    const disclosure = el("p",
      "Messages may contain sensitive text entered by you or returned by workers. They will be displayed in this paired browser.", "warning");
    const open = el("button", "Show messages");
    panel.append(el("h3", demo ? "Simulated conversation" : "Lead–worker conversation"));
    if (!demo) panel.append(disclosure, open);
    panel.append(rows, status, more);
    conversation = { runId, workerId: worker.agentId, demo, panel, rows, status, more,
      cursor: 0, through: -1, loading: false, moreAvailable: false, incomplete: false, omitted: 0, disclosed: demo };
    const current = conversation;
    open.onclick = () => { current.disclosed = true; open.hidden = true; loadConversation(current); };
    more.onclick = () => loadConversation(current);
  }
  inspectedKey = "";
  render();
}

function exampleExchange() {
  return [
    { seq: 1, sender: "lead", recipient: "builder", kind: "task", attemptId: "example-1", text: "Please implement the first-run screen." },
    { seq: 2, sender: "builder", recipient: "lead", kind: "result", attemptId: "example-1", text: "The welcome screen is ready for review." },
    { seq: 3, sender: "workflow", recipient: "builder", kind: "followup", attemptId: "example-2", text: "Review feedback: the Start button is skipped when tabbing. Please fix keyboard focus." },
    { seq: 4, sender: "builder", recipient: "lead", kind: "result", attemptId: "example-2", text: "Fixed the tab order. The Start button now receives keyboard focus." },
  ].slice(0, tick < 4 ? 1 : tick < 8 ? 3 : 4);
}

async function loadConversation(current) {
  if (conversation !== current || current.loading) return;
  const through = run()?.lastSeq || 0;
  current.loading = true;
  current.more.hidden = true;
  current.status.textContent = "Loading messages…";
  try {
    const page = current.demo ? { messages: exampleExchange().filter((m) => m.seq > current.cursor),
      nextAfterSeq: null, historyIncomplete: false } : await request(
      `/api/runs/${encodeURIComponent(current.runId)}/transcript`, { agentId: current.workerId, afterSeq: current.cursor });
    if (conversation !== current) return;
    current.incomplete ||= page.historyIncomplete;
    for (const m of page.messages) {
      const item = el("div", null, "transcript-message");
      item.append(el("strong", `${m.sender} → ${m.recipient} · ${m.kind}`),
        el("p", `Sequence ${m.seq} · attempt ${m.attemptId}`), el("pre", m.text));
      if (m.truncated) item.append(el("p", "Only part of this message is available.", "warning"));
      current.rows.append(item);
      current.cursor = m.seq;
      if (current.rows.childElementCount > 250) { current.rows.firstChild.remove(); current.omitted++; }
    }
    current.moreAvailable = page.nextAfterSeq !== null;
    current.cursor = page.nextAfterSeq ?? Math.max(current.cursor, through);
    current.through = through;
    current.more.hidden = !current.moreAvailable;
    current.more.textContent = "Load next messages";
    const notes = [];
    if (current.omitted) notes.push(`Showing the latest 250 loaded messages. ${current.omitted} earlier messages omitted.`);
    if (current.incomplete) notes.push("Some messages are missing or truncated.");
    if (!current.rows.childElementCount) notes.push(current.moreAvailable ? "No worker messages on this page." : "No messages recorded yet.");
    current.status.textContent = notes.join(" ");
  } catch (error) {
    if (conversation !== current) return;
    current.through = through;
    current.status.textContent = error.message;
    current.more.textContent = "Retry loading messages";
    current.more.hidden = false;
  } finally {
    current.loading = false;
    if (conversation === current && !current.moreAvailable && !current.demo &&
        live.connection === "live" && (run()?.lastSeq || 0) > through) loadConversation(current);
  }
}

function refreshConversation() {
  if (conversation?.disclosed && !conversation.moreAvailable && conversation.through < (run()?.lastSeq || 0) &&
      (demo || live.connection === "live")) loadConversation(conversation);
}
let inspectedKey = "",
  reviewedGate = null;
function gateIdentity(g) {
  return JSON.stringify([
    g.id,
    g.runId,
    g.status,
    g.diffHash,
    g.canApprove,
    g.canDeny,
    g.reason,
    g.diff,
  ]);
}
function updateAttention(r) {
  $("attention")?.remove();
  const pending = r.nodes.filter((n) => n.kind === "gate" && waiting(n.status));
  const gate = pending.find((n) => !n.awaitingLead) ?? pending[0];
  if (!gate) return;
  const button = el("button", gate.awaitingLead ? "Lead decision pending · Inspect →" : "● Your decision is waiting · Review →");
  button.id = "attention";
  button.onclick = () => select(gate.id);
  $("canvas").append(button);
}
function inspect() {
  const n = run()?.nodes.find((n) => n.id === selected),
    box = $("inspect");
  document.body.classList.toggle("inspecting", !!n);
  const key = JSON.stringify([
    runId,
    n,
    demo ? "example" : live.connection,
    n?.gateId && uncertain.has(n.gateId),
  ]);
  if (conversation && (conversation.runId !== runId || conversation.workerId !== n?.agentId ||
      conversation.demo !== demo)) conversation = null;
  if (key === inspectedKey) { refreshConversation(); return; }
  inspectedKey = key;
  const epoch = ++gateEpoch;
  reviewedGate = null;
  if ($("confirm").open) {
    $("submitDecision").disabled = true;
    $("decisionError").textContent =
      "The selected gate or its evidence changed. Close and review again.";
  }

  box.replaceChildren();
  if (!n) {
    const d = el("div", null, "inspect-empty");
    d.append(
      el("span", "↖"),
      el("h2", "Inspect a workflow card"),
      el(
        "p",
        "Select a card to see its identity, recorded status and next step.",
      ),
    );
    box.append(d);
    return;
  }
  box.append(
    el("span", n.kind, "badge"),
    el("h2", n.title),
    el("p", n.subtitle),
  );
  const dl = el("dl");
  for (const d of [
    {
      label: "Recorded status",
      value: n.status,
    },
    ...(n.details || []),
  ])
    dl.append(el("dt", d.label), el("dd", d.value));
  box.append(dl);
  if (n.kind === "run" && ((demo && runId === "example-run" && (tick < 16 || demoLeadApproved)) || n.canAuthorizeLead || n.leadApproved)) {
    const authorized = demo ? demoLeadApproved : n.leadApproved;
    const b = el("button", authorized ? "Lead decisions enabled" : "Allow lead decisions for this run…");
    const status = el("p", authorized ? "" : demo
      ? "Try letting the example lead approve the local commit after checks pass."
      : "The lead may decide plans and approve the verified local commit for this run. You confirm in macOS and handle escalations.");
    b.disabled = !!authorized;
    b.onclick = async () => {
      const selectedRun = runId;
      b.disabled = true;
      status.textContent = demo ? "Recording simulated authorization…" : "Confirm the request in the macOS authorization prompt. This can take up to 90 seconds.";
      try {
        if (!demo) await request(`/api/runs/${encodeURIComponent(selectedRun)}/authorize-lead`, {});
        if (demo) {
          demoLeadApproved = true;
          settleExampleLeadDecision();
        }
        b.textContent = "Lead decisions enabled";
        status.textContent = demo ? "Simulated authorization only." : "Lead authority recorded for this run.";
      } catch (error) {
        status.textContent = error.message;
        status.className = "warning";
        if (definitiveRejection(error)) b.disabled = false;
      }
    };
    box.append(b, status);
  }
  if (n.kind === "agent" && n.agentId && n.role !== "lead") {
    if (conversation) {
      box.append(conversation.panel);
      refreshConversation();
    } else {
      const b = el("button", "Open lead–worker conversation");
      b.onclick = () => selectConversation(n);
      box.append(b);
    }
  }
  if (n.targetRunId) {
    const b = el("button", "Follow linked run →", "primary");
    b.onclick = () => {
      runId = n.targetRunId;
      selected = null;
      render(true);
    };
    box.append(b);
  }
  if (n.kind === "gate" && n.gateId) {
    if (n.status !== "pending") {
      if (n.status === "approved" || n.status === "denied") {
        uncertain.delete(n.gateId);
        if (!demo) {
          const history = el("details");
          const identifiers = el("dl");
          identifiers.append(el("dt", "Run"), el("dd", runId), el("dt", "Gate"), el("dd", n.gateId));
          history.append(el("summary", "Decision record"), identifiers);
          history.addEventListener("toggle", async () => {
            if (!history.open) return;
            try {
              const record = await requestGate(n.gateId);
              if (epoch === gateEpoch && record.summary) history.append(el("p", record.summary));
            } catch {
              if (epoch === gateEpoch) history.append(el("p", "Recorded summary unavailable."));
            }
          }, {once: true});
          box.append(history);
        }
      }
      return;
    }
    box.append(el("p", "Loading current decision evidence…"));
    loadGate(n, epoch);
  }
}
const gateRequests = new Map();
function requestGate(id) {
  if (!gateRequests.has(id)) {
    const loading = request("/api/gates/" + encodeURIComponent(id)).finally(
      () => gateRequests.delete(id),
    );
    gateRequests.set(id, loading);
  }
  return gateRequests.get(id);
}
async function loadGate(n, epoch) {
  let g;
  try {
    g = demo
      ? {
          id: n.gateId,
          runId,
          kind: "integrate",
          status: n.status,
          summary: "Example: integrate the verified first-run change.",
          consequence:
            "The example moves to complete. No repository or daemon is changed.",
          canApprove: n.status === "pending",
          canDeny: n.status === "pending",
          diff: 'diff --git a/Welcome.swift b/Welcome.swift\n+ Text("Start your first task")',
          diffHash: "example-only · not real evidence",
          files: ["Welcome.swift"],
        }
      : await requestGate(n.gateId);
  } catch (e) {
    if (epoch === gateEpoch)
      $("inspect").append(
        el("p", "Evidence unavailable: " + e.message, "warning"),
      );
    return;
  }
  if (epoch !== gateEpoch) return;
  reviewedGate = g;
  const box = $("inspect");
  box.lastChild?.textContent === "Loading current decision evidence…" &&
    box.lastChild.remove();
  const presentation = gatePresentation(n, g);
  if (presentation === "recorded") {
    box.append(el("p", "Decision status: " + statusLabel(g.status)));
    if (g.status === "approved" || g.status === "denied") uncertain.delete(g.id);
    return;
  }
  let review = box;
  if (presentation === "lead") {
    review = el("details");
    review.append(el("summary", "Review as a person"));
    box.append(review);
  }
  review.append(el("p", g.summary), el("p", g.consequence, "warning"));
  const dl = el("dl");
  for (const [a, b] of [
    ["Run", g.runId],
    ["Gate", g.id],
    ["Current gate status", g.status],
    ["Frozen diff SHA-256", g.diffHash],
  ])
    if (b) dl.append(el("dt", a), el("dd", b));
  review.append(dl);
  if (g.files?.length) review.append(el("p", "Files: " + g.files.join(", ")));
  if (g.diff != null) {
    const d = el("details");
    d.open = true;
    d.append(
      el("summary", "Frozen diff · review before deciding"),
      el("pre", g.diff),
    );
    review.append(d);
  }
  if (g.reason) review.append(el("p", g.reason, "warning"));
  if (uncertain.has(g.id)) {
    review.append(
      el(
        "p",
        "Decision submitted. Outcome is uncertain; check daemon status before taking further action.",
        "warning",
      ),
    );
    return;
  }
  const actions = el("div", null, "gate-actions");
  for (const decision of ["approve", "deny"]) {
    const b = el(
      "button",
      decision === "approve" ? "Review & approve" : "Review & deny",
      decision === "approve" ? "primary" : "",
    );
    b.disabled =
      !(decision === "approve" ? g.canApprove : g.canDeny) ||
      (!demo && live.connection !== "live");
    b.onclick = () => {
      pending = {
        g,
        decision,
        demo,
        epoch,
        runId,
      };
      $("confirmTitle").textContent =
        decision === "approve" ? "Approve this exact gate?" : "Deny this gate?";
      $("confirmText").textContent =
        `${g.summary}\n${g.consequence}\nRun: ${g.runId} · Gate: ${g.id}${demo ? " · EXAMPLE ONLY" : ""}`;
      $("feedback").value = "";
      $("feedback").hidden = decision !== "deny";
      document.querySelector('label[for="feedback"]').hidden =
        decision !== "deny";
      $("decisionError").textContent = "";
      $("submitDecision").disabled = false;
      $("confirm").showModal();
    };
    actions.append(b);
  }
  review.append(actions);
}
// Decision helpers are pure so payload and failure semantics can be checked independently.

async function request(url, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (auth.token) headers.Authorization = "Bearer " + auth.token;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error("Server response unavailable");
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      data.error?.message || data.error || data.message || "Request rejected",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
$("submitDecision").onclick = async () => {
  const p = pending;
  if (!p) return;
  if (
    p.demo !== demo ||
    p.runId !== runId ||
    p.epoch !== gateEpoch ||
    !reviewedGate ||
    gateIdentity(p.g) !== gateIdentity(reviewedGate)
  ) {
    $("decisionError").textContent =
      "The selection changed. Close and review current evidence again.";
    return;
  }
  $("submitDecision").disabled = true;
  if (demo) {
    demoDecision = p.decision;
    tick = 16;
    playing = false;
    $("play").textContent = "Play";
    $("confirm").close();
    render();
    return;
  }
  uncertain.add(p.g.id);
  try {
    await request(
      "/api/gates/" + encodeURIComponent(p.g.id) + "/decision",
      decisionPayload(p.g, p.decision, $("feedback").value),
    );
    $("confirm").close();
    render();
  } catch (e) {
    if (definitiveRejection(e)) {
      uncertain.delete(p.g.id);
      inspectedKey = "";
      inspect();
      $("decisionError").textContent =
        e.message +
        (e.status === 409
          ? " · Gate or frozen evidence changed. Close and reopen the review before deciding."
          : " · Request rejected. Close and review the refreshed gate before retrying.");
    } else {
      $("decisionError").textContent =
        e.message +
        " · The result may be unknown. Close and inspect current status before retrying.";
    }
  }
};
$("runs").onchange = () => {
  runId = $("runs").value;
  selected = null;
  render(true);
};
$("clear").onclick = () => select(null);
$("fit").onclick = fit;
function zoom(
  f,
  x = $("canvas").clientWidth / 2,
  y = $("canvas").clientHeight / 2,
) {
  const old = camera.z;
  camera.z = Math.max(0.12, Math.min(2.2, old * f));
  camera.x = x - ((x - camera.x) * camera.z) / old;
  camera.y = y - ((y - camera.y) * camera.z) / old;
  applyCamera();
}
$("zoomIn").onclick = () => zoom(1.2);
$("zoomOut").onclick = () => zoom(1 / 1.2);
$("canvas").addEventListener(
  "wheel",
  (e) => {
    if (e.target.closest("#exampleBar")) return;
    e.preventDefault();
    const b = $("canvas").getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - b.left, e.clientY - b.top);
  },
  {
    passive: false,
  },
);
let drag;
$("canvas").onpointerdown = (e) => {
  if (e.target.closest("button, .conversation-edge")) return;
  drag = {
    x: e.clientX,
    y: e.clientY,
    cx: camera.x,
    cy: camera.y,
  };
  $("canvas").setPointerCapture(e.pointerId);
};
$("canvas").onpointermove = (e) => {
  if (!drag) return;
  camera.x = drag.cx + e.clientX - drag.x;
  camera.y = drag.cy + e.clientY - drag.y;
  applyCamera();
};
$("canvas").onpointerup = () => (drag = null);
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input,textarea,select,dialog")) return;
  if (e.key.toLowerCase() === "f") fit();
  if (e.key === "Escape") select(null);
  if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
    e.target === $("canvas")
  ) {
    e.preventDefault();
    camera.x += e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
    camera.y += e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0;
    applyCamera();
  }
});
function startExample() {
  $("edges").classList.remove("paused");
  demo = true;
  tick = 0;
  demoDecision = null;
  demoLeadApproved = false;
  conversation = null;
  playing = true;
  runId = "example-run";
  selected = null;
  $("play").textContent = "Pause";
  render(true);
}
$("example").onclick = $("emptyExample").onclick = startExample;
$("restart").onclick = startExample;
$("play").onclick = () => {
  playing = !playing;
  $("play").textContent = playing ? "Pause" : "Play";
  $("edges").classList.toggle("paused", !playing);
};
$("exit").onclick = () => {
  $("edges").classList.remove("paused");
  demo = false;
  selected = null;
  runId = null;
  render(true);
};
function settleExampleLeadDecision() {
  if (!demo || !demoLeadApproved || tick < 12 || tick >= 16) return;
  demoDecision = "lead";
  tick = 16;
  playing = false;
  $("play").textContent = "Play";
  render();
}
setInterval(() => {
  if (demo && playing && tick < 15) {
    tick++;
    if (demoLeadApproved && tick >= 12) { settleExampleLeadDecision(); return; }
    if (tick % 4 === 0) render();
  }
}, 1200);
async function connect() {
  const fragment = new URLSearchParams(location.hash.slice(1)),
    key = fragment.get("key");
  if (key) {
    history.replaceState(null, "", location.pathname + location.search);
    try {
      auth = await request("/api/session", {
        key,
      });
      try {
        sessionStorage.setItem("acp-workflow-session", JSON.stringify(auth));
      } catch {}
    } catch (e) {
      live.connection = "offline";
      live.message = "Pairing failed: " + e.message;
      render();
      return;
    }
  }
  if (!auth.streamToken) {
    live.connection = "offline";
    live.message =
      "Browser not paired. Open the local launch URL printed by the server to connect to ACP. The example is available without pairing.";
    if (!demo) render();
    return;
  }
  source = new EventSource(
    "/api/events?token=" + encodeURIComponent(auth.streamToken),
  );
  source.onmessage = (e) => {
    try {
      const next = JSON.parse(e.data);
      if (!Array.isArray(next.runs)) return;
      const first = !live.runs.length;
      live = next;
      if (!demo) render(first);
    } catch {
      live.connection = "offline";
      live.message =
        "Received an unreadable update; waiting for a valid snapshot.";
      if (!demo) render();
    }
  };
  source.onerror = () => {
    live.connection = "offline";
    live.message =
      "Connection lost or browser is unpaired. Use the launch URL to pair; reconnecting automatically.";
    if (!demo) render();
  };
}
render();
if (new URLSearchParams(location.search).get("example") === "1") startExample();
connect();
// Opening the pairing link in an already open map changes only its fragment.
// Reload through the usual startup path so it consumes the key and replaces the old stream.
window.addEventListener("hashchange", () => {
  if (new URLSearchParams(location.hash.slice(1)).has("key")) location.reload();
});

// Native focus scrolling must never replace the camera. Reveal cards by panning.
$("nodes").addEventListener("focusin", (event) => {
  if (restoringFocus) return;
  const point = positions.get(event.target.dataset.nodeId);
  if (!point) return;
  const box = $("canvas").getBoundingClientRect();
  const left = camera.x + point.x * camera.z;
  const top = camera.y + point.y * camera.z;
  if (left < 20 || left + 252 * camera.z > box.width - 20)
    camera.x = box.width / 2 - (point.x + 126) * camera.z;
  if (
    top < 140 ||
    top + (heights.get(event.target.dataset.nodeId) || 145) * camera.z >
      box.height - 70
  )
    camera.y = 160 - point.y * camera.z;
  $("canvas").scrollTop = 0;
  $("canvas").scrollLeft = 0;
  applyCamera();
});
let resizeFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => render(true));
}).observe($("canvas"));
