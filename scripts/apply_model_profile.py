#!/usr/bin/env python3
"""Validate and apply a model profile into Codex subagent TOML files.

Never queries an API or claims model availability. The user must provide a checked
set of model IDs via --available-models. Default inherit leaves files unpinned.
"""
import argparse,json,re,sys,tomllib
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
POLICY=ROOT/'policy/model-routing.json'
AGENTS=ROOT/'.codex/agents'

def update_config(text,model,effort):
    text=re.sub(r'(?m)^(?:model|model_reasoning_effort)\s*=.*\n','',text)
    if model:
        assert effort in ('low','medium','high'), effort
        # insert after description; valid top-level TOML keys
        text=re.sub(r'(?m)^(description\s*=.*\n)',lambda m:m.group(1)+f'model = "{model}"\nmodel_reasoning_effort = "{effort}"\n',text,count=1)
    return text

def validate(policy):
    names=set(policy['roles'])
    actual={p.stem for p in AGENTS.glob('*.toml')}
    if names!=actual: raise ValueError(f'Agent mismatch: policy={names} files={actual}')
    if policy['max_parallel_subagents']>2: raise ValueError('Too many subagents')
    for role,routing in policy['roles'].items():
        assert routing['default_tier'] in ('economy','balanced','deep')
        assert routing['default_effort'] in ('low','medium','high')
        cfg=tomllib.loads((AGENTS/f'{role}.toml').read_text())
        if cfg['name']!=role:raise ValueError(f'Invalid agent name: {role}')
        if ('model' in cfg)!=('model_reasoning_effort' in cfg): raise ValueError(f'Model/effort must be paired: {role}')
    cfg=tomllib.loads((ROOT/'.codex/config.toml').read_text())
    if cfg['agents']['max_concurrent_threads_per_session']>2:raise ValueError('Concurrency exceeds governance cap')

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--profile',default='inherit',choices=['inherit','example'])
    ap.add_argument('--available-models',help='Comma-separated model IDs confirmed in YOUR Codex client')
    ap.add_argument('--apply',action='store_true',help='Modify agent TOML; otherwise dry run')
    args=ap.parse_args()
    policy=json.loads(POLICY.read_text())
    validate(policy)
    models=policy['profiles'][args.profile]['tier_models']
    checked={x.strip() for x in (args.available_models or '').split(',') if x.strip()}
    wants={x for x in models.values() if x}
    if wants and not wants.issubset(checked):
        sys.exit('DENIED: model availability unconfirmed. Pass --available-models with every chosen model ID after checking your Codex client.')
    print(f'Profile: {args.profile}; mode: {"APPLY" if args.apply else "DRY RUN"}')
    pending=[]
    for role,config in policy['roles'].items():
        model=models[config['default_tier']]
        effort=config['default_effort'] if model else None
        print(f'  {role:10} model={model or "inherit":14} effort={effort or "inherit"}')
        path=AGENTS/f'{role}.toml'
        result=update_config(path.read_text(),model,effort)
        tomllib.loads(result)
        pending.append((path,result))
    if args.apply:
        for path,result in pending:path.write_text(result)
        validate(policy)
        print('Applied and validated all seven agent configs.')
    else:
        print('No files changed. Use --apply to commit changes.')

if __name__=='__main__':main()
