import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewGate } from '../gate-review.mjs';

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const gateId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const attemptId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'map-'));
  const dir = path.join(root, 'runs', runId);
  await mkdir(path.join(dir, 'gates'), { recursive: true });
  const diffDir = path.join(root, 'runs', runId.replaceAll('-', ''), 'diffs');
  await mkdir(diffDir, { recursive: true });
  const diffPath = path.join(diffDir, `${attemptId}.patch`);
  const payloadPath = path.join(dir, 'gates', `${gateId}.payload.json`);
  const diff = 'diff --git a/a b/a\n';
  await writeFile(diffPath, diff);
  await writeFile(
    payloadPath,
    JSON.stringify({
      diffPath,
      diffHash: createHash('sha256').update(diff).digest('hex'),
      worktree: '/private/work',
      preSha: 'abc',
      files: ['a'],
    }),
  );
  return {
    root,
    dir,
    diffDir,
    diff,
    diffPath,
    payloadPath,
    gate: { runId, gateId, payloadPath, kind: 'integrate', status: 'pending' },
  };
}

test('verifies tied diff and rejects changed evidence and stale decisions', async () => {
  const f = await fixture();
  try {
    let result = await reviewGate(f.gate, f.root);
    assert.equal(result.canApprove, true);
    assert.equal(result.diff, f.diff);
    assert.equal(result.canDeny, true);
    await writeFile(f.diffPath, 'changed');
    result = await reviewGate(f.gate, f.root);
    assert.equal(result.canApprove, false);
    assert.match(result.reason, /unavailable/);
    assert.ok(!result.reason.includes(f.root));
    assert.equal((await reviewGate({ ...f.gate, status: 'resolved' }, f.root)).canDeny, false);
    assert.equal(
      (await reviewGate({ ...f.gate, payloadPath: '/tmp/wrong' }, f.root)).canApprove,
      false,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects final and intermediate symlinks and nonblocking FIFO', async () => {
  const f = await fixture();
  try {
    await rm(f.diffPath);
    await symlink('/etc/passwd', f.diffPath);
    assert.equal((await reviewGate(f.gate, f.root)).canApprove, false);
    await rm(f.diffPath);
    execFileSync('mkfifo', [f.diffPath]);
    assert.equal((await reviewGate(f.gate, f.root)).canApprove, false);
    await rm(f.diffPath);
    await rename(f.diffDir, `${f.diffDir}-actual`);
    await symlink(`${f.diffDir}-actual`, f.diffDir);
    assert.equal((await reviewGate(f.gate, f.root)).canApprove, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('permits canonical state directory aliases', async () => {
  const f = await fixture();
  const alias = `${f.root}-alias`;
  try {
    await symlink(f.root, alias);
    assert.equal((await reviewGate(f.gate, alias)).canApprove, true);
  } finally {
    await rm(alias, { force: true });
    await rm(f.root, { recursive: true, force: true });
  }
});

test('plan, escalation and unknown decisions expose supported actions', async () => {
  const gate = { runId, gateId, status: 'pending' };
  const plan = await reviewGate({ ...gate, kind: 'plan' }, '/tmp');
  assert.equal(plan.canApprove, true);
  assert.equal(plan.canDeny, true);
  const escalation = await reviewGate({ ...gate, kind: 'escalate' }, '/tmp');
  assert.equal(escalation.canApprove, false);
  assert.equal(escalation.canDeny, true);
  const unknown = await reviewGate({ ...gate, kind: 'future' }, '/tmp');
  assert.equal(unknown.canApprove, false);
  assert.equal(unknown.canDeny, false);
});

test('Claude versions come only from a linked attempt’s bounded initialization header', async () => {
  const { reportedModels } = await import('../reported-models.mjs');
  const f = await fixture();
  try {
    const dir = path.join(f.root, 'runs', runId.replaceAll('-', ''), 'attempts', attemptId.replaceAll('-', ''));
    await mkdir(dir, {recursive: true});
    const file = path.join(dir, 'stdout.jsonl');
    const snapshot = {agents:[{runId, agentId: gateId, provider:'claude'}], attempts:[{runId, agentId:gateId, attemptId}]};
    const read = () => reportedModels(snapshot, f.root, new Map());
    const header = JSON.stringify({type:'system', subtype:'init', model:'claude-opus-5-5', extra:'private'});
    await writeFile(file, header + '\n' + JSON.stringify({model:'private', text:'private'}));
    assert.deepEqual([...(await read()).values()], ['claude-opus-5-5']);
    for (const invalid of ['{}\n' + header + '\n', header, ' '.repeat(16384) + header + '\n',
      header.replace('claude-opus-5-5', 'private'), header.replace('"system"', '"assistant"')]) {
      await writeFile(file, invalid);
      assert.equal((await read()).size, 0);
    }
    await rename(file, file + '.elsewhere');
    await writeFile(file + '.elsewhere', header + '\n');
    await symlink(file + '.elsewhere', file);
    assert.equal((await read()).size, 0);
  } finally {
    await rm(f.root, {recursive:true, force:true});
  }
});
