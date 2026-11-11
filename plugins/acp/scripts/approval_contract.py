#!/usr/bin/env python3
"""Read-only validation for ACP integration-gate evidence.

This module cannot establish who answered a host prompt and never executes ACP.  A host may
construct ``HostDecision`` only after applying its own native-response rules.  The result is an
exact command-shaped tuple for a recorder or for the host to relay through its existing CLI path.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


class ContractRefusal(ValueError):
    """The evidence or decision is incomplete, stale, or no longer actionable."""


@dataclass(frozen=True)
class FrozenGate:
    repository: str
    run_id: str
    gate_id: str
    attempt_id: str
    diff_hash: str
    base: str
    branch: str
    checks: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class HostDecision:
    """A decision already authenticated by the host boundary, not by fields in a payload."""

    choice: str
    feedback: str | None = None

    def __post_init__(self):
        if self.choice not in {"approve", "deny", "wait"}:
            raise ContractRefusal("unknown host decision")
        if self.choice == "deny" and not (self.feedback and self.feedback.strip()):
            raise ContractRefusal("denial requires human feedback")
        if self.choice != "deny" and self.feedback is not None:
            raise ContractRefusal("feedback is valid only for denial")


@dataclass(frozen=True)
class RelayPlan:
    action: str
    argv: tuple[str, ...] | None
    reason: str


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractRefusal(f"missing required field: {field}")
    return value


def _checks(value: Any) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, list):
        raise ContractRefusal("missing required field: checks")
    selected = []
    seen = set()
    for index, check in enumerate(value):
        if not isinstance(check, Mapping):
            raise ContractRefusal(f"invalid check at index {index}")
        if check.get("selected") is not True:
            continue
        name = _text(check.get("name"), f"checks[{index}].name")
        outcome = _text(check.get("outcome"), f"checks[{index}].outcome")
        if name in seen:
            raise ContractRefusal(f"duplicate selected check: {name}")
        seen.add(name)
        selected.append((name, outcome))
    return tuple(sorted(selected))


def freeze_gate(status: Mapping[str, Any], gate: Mapping[str, Any]) -> FrozenGate:
    """Bind a pending integrate gate to its status and bounded gate snapshots."""

    repository = _text(status.get("repository"), "repository")
    if not Path(repository).is_absolute():
        raise ContractRefusal("repository must be absolute")
    run_id = _text(status.get("runId"), "runId")
    branch = _text(status.get("branch"), "branch")
    attempt = status.get("attempt")
    if not isinstance(attempt, Mapping):
        raise ContractRefusal("missing required field: attempt")
    attempt_id = _text(attempt.get("id"), "attempt.id")
    gate_id = _text(gate.get("id"), "gate.id")
    if gate.get("kind") != "integrate":
        raise ContractRefusal("gate is not an integrate gate")
    if gate.get("status") != "pending":
        raise ContractRefusal("gate is already resolved")
    if gate.get("runId") != run_id:
        raise ContractRefusal("gate run changed")
    if gate.get("attemptId") != attempt_id:
        raise ContractRefusal("gate attempt changed")
    if gate.get("branch") != branch:
        raise ContractRefusal("gate branch changed")
    return FrozenGate(
        repository=repository,
        run_id=run_id,
        gate_id=gate_id,
        attempt_id=attempt_id,
        diff_hash=_text(gate.get("diffHash"), "gate.diffHash"),
        base=_text(gate.get("base"), "gate.base"),
        branch=branch,
        checks=_checks(gate.get("checks")),
    )


def plan_relay(frozen: FrozenGate, current_status: Mapping[str, Any],
               current_gate: Mapping[str, Any], decision: HostDecision) -> RelayPlan:
    """Re-check exact evidence and return a non-executing, scoped relay plan."""

    if not isinstance(decision, HostDecision):
        raise ContractRefusal("decision must come from the host boundary")
    if decision.choice == "wait":
        return RelayPlan("none", None, "host chose wait")
    current = freeze_gate(current_status, current_gate)
    if current != frozen:
        raise ContractRefusal("gate evidence changed after the host decision")
    if decision.choice == "approve":
        argv = ("acp", "gate", "approve", frozen.gate_id, "--repo", frozen.repository)
    else:
        argv = ("acp", "gate", "deny", frozen.gate_id, "--repo", frozen.repository,
                "--feedback", decision.feedback.strip())
    return RelayPlan(decision.choice, argv, "exact frozen evidence re-checked")
