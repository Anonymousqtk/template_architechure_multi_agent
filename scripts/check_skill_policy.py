#!/usr/bin/env python3
"""Static, offline governance checks. Does not prove runtime skill use or standard compliance."""
import json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
errors=[]
def load(p):
    try:return json.loads((ROOT/p).read_text(encoding="utf-8"))
    except Exception as e: errors.append(f"{p}: {e}");return {}
sources=load('policy/skill-sources.json').get('sources',{})
router=load('policy/skill-routing.json')
root=ROOT/router.get('skills_root','.codex/skills')
known=set()
for p in sorted(root.glob('*/SKILL.md')):
    raw=p.read_text(encoding='utf-8')
    match=re.match(r'\A---\n(.*?)\n---\n',raw,re.S)
    if not match:errors.append(f'{p}: missing YAML frontmatter');continue
    meta=match.group(1)
    n=re.search(r'^name:\s*(.+)$',meta,re.M)
    d=re.search(r'^description:\s*(.+)$',meta,re.M)
    if not n or n.group(1).strip()!=p.parent.name:errors.append(f'{p}: invalid name')
    if not d or len(d.group(1).strip())<25:errors.append(f'{p}: missing/short description')
    if len(raw)>3200:errors.append(f'{p}: oversized body (token discipline)')
    known.add(p.parent.name)
    for source in re.findall(r'^- `([^`]+)`',raw,re.M):
        if source not in sources:errors.append(f'{p}: unapproved source {source}')
for role,skills in router.get('roles',{}).items():
    for s in skills:
        if s not in known:errors.append(f'role {role}: missing skill {s}')
for trigger,skills in router.get('cross_cutting',{}).items():
    for s in skills:
        if s not in known:errors.append(f'trigger {trigger}: missing skill {s}')
for sid,v in sources.items():
    if not v.get('url','').startswith('https://'):errors.append(f'source {sid}: non-HTTPS')
    if v.get('status') not in ('stable','final','official','vendor','recommendation'):errors.append(f'source {sid}: wrong status')
if len(known)!=len(set(sum(router.get('roles',{}).values(),[]))):errors.append('unregistered or duplicate skill')
if not 1<=router.get('max_skills_per_task',0)<=2:errors.append('max_skills_per_task must be 1..2')
if errors:
    print('FAIL skill governance:')
    for e in errors:print(' -',e)
    sys.exit(1)
print(f'PASS skill governance: {len(known)} approved skills, {len(sources)} official references; offline check only')
