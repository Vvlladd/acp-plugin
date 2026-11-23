import { openEvidence } from './gate-review.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const claudeId = /^claude-(?:opus|sonnet|haiku|fable)-[0-9]{1,2}-[0-9]{1,2}(?:-[0-9]{8})?$/;
const prefixLimit = 16 * 1024;

// Older daemons retain Claude's model ID in the native initialization record. Use
// only that first complete line. No transcript content or arbitrary path is returned.
async function readModel(stateDir, runId, attemptId) {
  const file = await openEvidence(stateDir, ['runs', runId.replaceAll('-', ''), 'attempts',
    attemptId.replaceAll('-', ''), 'stdout.jsonl']);
  try {
    if (!(await file.stat()).isFile()) return null;
    const buffer = Buffer.alloc(prefixLimit);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end < 0) return null;
    const init = JSON.parse(buffer.toString('utf8', 0, end));
    return init?.type === 'system' && init.subtype === 'init' && typeof init.model === 'string'
      && claudeId.test(init.model) ? init.model : null;
  } finally {
    await file.close();
  }
}

export async function reportedModels(snapshot, stateDir, cache) {
  const agents = new Set((snapshot.agents || []).filter(a => a?.provider === 'claude')
    .map(a => a.runId + '/' + a.agentId));
  const attempts = (snapshot.attempts || []).filter(a => uuid.test(a?.runId) && uuid.test(a.attemptId)
    && agents.has(a.runId + '/' + a.agentId))
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))).slice(0, 250);
  const ids = new Map();
  for (let i = 0; i < attempts.length; i += 8) {
    await Promise.all(attempts.slice(i, i + 8).map(async a => {
      const key = a.runId + '/' + a.attemptId;
      let entry = cache.get(key);
      if (!entry || (!entry.model && entry.retryAt <= Date.now())) {
        const model = await readModel(stateDir, a.runId, a.attemptId).catch(() => null);
        entry = { model, retryAt: Date.now() + 15000 };
        cache.set(key, entry);
      }
      if (entry.model) ids.set(key, entry.model);
    }));
  }
  while (cache.size > 500) cache.delete(cache.keys().next().value);
  return ids;
}
