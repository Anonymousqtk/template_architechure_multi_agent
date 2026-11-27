#!/usr/bin/env python3
"""Single source of truth for affected scopes; conservative on CI logic changes."""
import os
import subprocess
from pathlib import PurePosixPath

base = os.environ.get('BASE_SHA', '').strip()
head = os.environ.get('HEAD_SHA', 'HEAD').strip() or 'HEAD'
pr = os.environ.get('EVENT_NAME') == 'pull_request'
if pr and base:
    changed = subprocess.check_output(['git', 'diff', '--name-only', f'{base}...{head}'], text=True).splitlines()
else:
    # workflow_dispatch: explicit full verification, not an inferred diff.
    changed = ['frontend/', 'backend/', 'database/', 'scripts/']

all_scopes = {'frontend': False, 'backend': False, 'database': False}
for path in changed:
    if path.startswith(('.github/', '.codex/', '.claude/', 'scripts/', 'policy/')) or path in ('AGENTS.md', 'CLAUDE.md', 'database/check.sh', 'package.json', 'package-lock.json'):
        all_scopes = dict.fromkeys(all_scopes, True)
        break
    if path.startswith('contracts/'):
        all_scopes = dict.fromkeys(all_scopes, True)
        break
    for key in all_scopes:
        if path == key or path.startswith(key + '/'):
            all_scopes[key] = True
# Codex instructions and docs alone do not trigger app builds.
flags = {**all_scopes, 'code': any(all_scopes.values()),
         'sast': all_scopes['frontend'] or all_scopes['backend']}
output = os.environ.get('GITHUB_OUTPUT')
if not output:
    raise SystemExit('GITHUB_OUTPUT must be set')
with open(output, 'a', encoding='utf-8') as out:
    for key, value in flags.items():
        out.write(f'{key}={str(value).lower()}\n')
print('Changed paths:', changed)
print('Affected scopes:', flags)
