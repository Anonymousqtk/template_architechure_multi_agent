#!/usr/bin/env python3
"""Fail-closed PR change-scope check. This validates declared PR intent, NOT AI identity."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = json.loads((ROOT / 'policy/ownership.json').read_text())
SCOPES = {'frontend', 'backend', 'database', 'tests', 'governance'}

def changed_files():
    base = os.getenv('BASE_SHA', '').strip()
    head = os.getenv('HEAD_SHA', 'HEAD').strip() or 'HEAD'
    if not base:
        raise ValueError('BASE_SHA required for PR enforcement')
    data = subprocess.check_output(['git', 'diff', '--name-only', f'{base}...{head}'], cwd=ROOT, text=True)
    return [v.strip() for v in data.splitlines() if v.strip()]

def scope_of(p):
    for scope in ('frontend', 'backend', 'database', 'tests'):
        if p == scope or p.startswith(scope + '/'):
            return scope
    return 'governance'

def validate(paths, task):
    errors = []
    changed_scopes = {scope_of(p) for p in paths if p != '.agent-task.json'}
    # docs-only changes need no manifest; they cannot weaken quality policy without governance.
    meaningful = {p for p in paths if not (p.startswith('docs/') or p in {'README.md', '.agent-task.json'})}
    if not meaningful:
        return []
    if not task:
        return ['Missing .agent-task.json for code/config changes']
    declared = task.get('allowed_scopes')
    if not isinstance(declared, list) or not declared or set(declared) - SCOPES:
        errors.append('allowed_scopes must be a non-empty list of valid scopes')
        declared = []
    undeclared = changed_scopes - set(declared)
    if undeclared:
        errors.append('Undeclared changed scopes: ' + ', '.join(sorted(undeclared)))
    if not isinstance(task.get('id'), str) or not task['id'].strip():
        errors.append('Task must have a nonempty id')
    if not isinstance(task.get('summary'), str) or not task['summary'].strip():
        errors.append('Task must have a nonempty summary')
    if not isinstance(task.get('acceptance'), list) or not task['acceptance']:
        errors.append('Task requires acceptance criteria')
    risk = task.get('risk')
    if risk not in {'normal', 'high'}:
        errors.append('risk must be normal or high')
    protected = [p for p in paths if p in POLICY['protected_files'] or any(p.startswith(prefix) for prefix in POLICY['protected_prefixes'])]
    sensitive = [p for p in paths if any(p.startswith(prefix) for prefix in POLICY['sensitive_prefixes']) or any(term in p.lower() for term in POLICY['sensitive_path_terms'])]
    if protected and 'governance' not in declared:
        errors.append('Governance scope required for protected changes')
    if protected and risk != 'high':
        errors.append('Protected changes must declare high risk')
    if sensitive and risk != 'high':
        errors.append('Sensitive changes must declare high risk')
    if sensitive and task.get('security_review_required') is not True:
        errors.append('Sensitive changes must explicitly require security review')
    if task.get('security_review_required') not in (True, False):
        errors.append('security_review_required must be boolean')
    return errors

def main():
    paths = changed_files()
    task_path = ROOT / '.agent-task.json'
    try:
        task = json.loads(task_path.read_text()) if task_path.exists() else None
    except json.JSONDecodeError as exc:
        print('Invalid .agent-task.json:', exc, file=sys.stderr)
        return 1
    errors = validate(paths, task)
    print('Changed:', paths)
    print('Declared scopes:', task.get('allowed_scopes') if task else 'none')
    if errors:
        for error in errors:
            print('POLICY FAIL:', error, file=sys.stderr)
        return 1
    print('POLICY PASS: changed-file intent is valid (not a proof of agent identity or human approval)')
    return 0

if __name__ == '__main__':
    sys.exit(main())
