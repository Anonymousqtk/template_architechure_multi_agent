#!/usr/bin/env python3
"""Static consistency gate for model routing policy and Codex TOML. No AI calls."""
import json,sys,tomllib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    cfg=json.loads((ROOT/'policy/model-routing.json').read_text())
    agents={p.stem:p for p in (ROOT/'.codex/agents').glob('*.toml')}
    if set(agents)!=set(cfg['roles']):raise ValueError('Agent role drift')
    if cfg['max_parallel_subagents']!=1:raise ValueError('Unexpected concurrency policy')
    parent=tomllib.loads((ROOT/'.codex/config.toml').read_text())
    if parent['agents']['max_concurrent_threads_per_session']!=1:raise ValueError('Concurrency config drift')
    chosen=set()
    for role,p in agents.items():
        doc=tomllib.loads(p.read_text()); r=cfg['roles'][role]
        if doc['name']!=role or not doc.get('developer_instructions'):raise ValueError('Broken agent '+role)
        if r['default_tier'] not in ('economy','balanced','deep'):raise ValueError('Invalid tier '+role)
        if r['default_effort'] not in ('low','medium','high'):raise ValueError('Invalid effort '+role)
        if ('model' in doc)!=('model_reasoning_effort' in doc):raise ValueError('Incomplete pin '+role)
        if 'model' in doc:
            if doc['model_reasoning_effort']!=r['default_effort']:raise ValueError('Effort drift '+role)
            chosen.add(doc['model'])
    if chosen:
        matches=[]
        for name,entry in cfg['profiles'].items():
            expected=entry['tier_models']
            if all(tomllib.loads(path.read_text()).get('model') == expected[cfg['roles'][role]['default_tier']]
                   for role,path in agents.items()):
                matches.append(name)
        if not matches: raise ValueError('Pinned model profile does not match policy')
    print('PASS: seven agents, model routing, effort, concurrency and profile consistency')
if __name__=='__main__':
    try:main()
    except (ValueError,KeyError,tomllib.TOMLDecodeError) as exc:print('FAIL:',exc,file=sys.stderr);sys.exit(1)
