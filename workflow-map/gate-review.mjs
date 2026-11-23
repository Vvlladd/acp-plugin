import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIFF_LIMIT = 8 * 1024 * 1024;
const O_NOFOLLOW_ANY = 0x20000000; // Darwin sys/fcntl.h

export async function openEvidence(root, components) {
  const canonicalRoot = await realpath(root);
  const flags = constants.O_RDONLY | constants.O_NONBLOCK;
  if (process.platform === 'darwin') {
    // The kernel rejects symlinks in every component in the same open operation.
    return open(path.join(canonicalRoot, ...components), flags | O_NOFOLLOW_ANY);
  }
  if (process.platform !== 'linux') throw new Error('Unsupported platform');

  // Pin each directory before opening the next component. /proc/self/fd follows the
  // descriptor, not an attacker-replaceable pathname; NOFOLLOW applies to the child.
  let directory = await open(canonicalRoot, flags | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const component of components.slice(0, -1)) {
      const next = await open(
        `/proc/self/fd/${directory.fd}/${component}`,
        flags | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await directory.close();
      directory = next;
    }
    return await open(
      `/proc/self/fd/${directory.fd}/${components.at(-1)}`,
      flags | constants.O_NOFOLLOW,
    );
  } finally {
    await directory.close();
  }
}

async function boundedFile(root, components, limit) {
  const file = await openEvidence(root, components);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid evidence');
    const bytes = Buffer.alloc(stat.size + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await file.read(bytes, used, bytes.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used !== stat.size) throw new Error('Changed evidence');
    return bytes.subarray(0, used);
  } finally {
    await file.close();
  }
}

async function belongsToState(candidate, stateDir, canonicalState, components) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return false;
  const resolved = path.resolve(candidate);
  if ([stateDir, canonicalState].some((root) => resolved === path.resolve(root, ...components)))
    return true;
  try {
    return (await realpath(candidate)) === path.resolve(canonicalState, ...components);
  } catch {
    return false;
  }
}

export async function reviewGate(gate = {}, stateDir) {
  const { gateId: id, runId, kind, status } = gate;
  const result = {
    id,
    runId,
    kind,
    status,
    summary: typeof gate.summary === 'string' ? gate.summary.slice(0, 4000) : '',
    consequence: 'Unknown decision type.',
    canApprove: false,
    canDeny: false,
  };
  if (
    !UUID.test(id || '') ||
    !UUID.test(runId || '') ||
    !['integrate', 'plan', 'escalate'].includes(kind)
  ) {
    result.reason = 'Unknown or invalid decision';
    return result;
  }
  if (kind === 'plan')
    result.consequence =
      'Approval answers the plan question and allows the plan to continue; denial blocks it.';
  if (kind === 'escalate')
    result.consequence = 'Deny with feedback to answer the escalation. Approval is not supported.';
  if (kind === 'integrate')
    result.consequence =
      'Approval integrates the reviewed changes; denial rejects this integration.';
  if (status !== 'pending') {
    result.reason = 'Decision is no longer pending';
    return result;
  }
  result.canDeny = true;
  if (kind === 'plan') {
    result.canApprove = true;
    return result;
  }
  if (kind === 'escalate') return result;

  try {
    const canonicalState = await realpath(stateDir);
    const payloadParts = ['runs', runId, 'gates', `${id}.payload.json`];
    if (!(await belongsToState(gate.payloadPath, stateDir, canonicalState, payloadParts)))
      throw new Error('Invalid payload');
    const payload = JSON.parse(
      (await boundedFile(canonicalState, payloadParts, 1024 * 1024)).toString('utf8'),
    );
    if (
      !/^[0-9a-f]{64}$/.test(payload.diffHash || '') ||
      !payload.worktree ||
      !payload.preSha ||
      typeof payload.diffPath !== 'string'
    ) {
      throw new Error('Invalid payload');
    }
    const basename = path.basename(payload.diffPath);
    const match = /^([0-9a-f-]{36})\.patch$/i.exec(basename);
    const diffParts = ['runs', runId.replaceAll('-', ''), 'diffs', basename];
    if (
      !match ||
      !UUID.test(match[1]) ||
      !(await belongsToState(payload.diffPath, stateDir, canonicalState, diffParts))
    ) {
      throw new Error('Invalid diff path');
    }
    const diff = await boundedFile(canonicalState, diffParts, DIFF_LIMIT);
    if (createHash('sha256').update(diff).digest('hex') !== payload.diffHash)
      throw new Error('Hash mismatch');
    result.diff = new TextDecoder('utf-8', { fatal: true }).decode(diff);
    result.diffHash = payload.diffHash;
    result.files = Array.isArray(payload.files)
      ? payload.files
          .filter(
            (f) =>
              typeof f === 'string' &&
              f.length <= 500 &&
              !path.isAbsolute(f) &&
              !f.split('/').includes('..'),
          )
          .slice(0, 500)
      : [];
    result.canApprove = true;
  } catch {
    // Never return filesystem or parser errors: they can contain private paths or content.
    result.reason = 'Review evidence is unavailable or does not match this decision';
  }
  return result;
}
