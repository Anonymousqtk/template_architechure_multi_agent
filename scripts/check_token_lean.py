#!/usr/bin/env python3
"""Static guard: policy coherence, not a runtime token/delegation interceptor."""
import json, tomllib, sys
from pathlib import Path
r=Path(__file__).resolve().parents[1]
try:
  b=json.loads((r/'policy/token-budget.json').read_text())
  m=json.loads((r/'policy/model-routing.json').read_text())
  s=json.loads((r/'policy/skill-routing.json').read_text())
  cfg=tomllib.loads((r/'.codex/config.toml').read_text())
  assert b['mode']=='advisory_not_enforced'
  assert cfg['agents']['max_concurrent_threads_per_session']==1
  assert b['limits']['max_concurrent_subagents']==1
  assert m['max_parallel_subagents']==1
  assert b['limits']['small']['max_delegations']==0
  assert b['limits']['medium']['max_delegations']==0
  assert b['limits']['complex']['max_delegations']==1
  assert m['routing']['default_max_delegations']==0
  assert s['max_skills_per_task']==1
  assert set(m['profiles'])=={'inherit'}
  print('PASS: V5.3 policy consistency; token meter NOT enforced')
except (KeyError, ValueError, AssertionError, OSError) as e:
  print('FAIL: token-lean policy mismatch',repr(e),file=sys.stderr);sys.exit(1)
