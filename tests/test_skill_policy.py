import json,subprocess,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class TestSkillPolicy(unittest.TestCase):
    def test_validator_passes(self):
        p=subprocess.run([sys.executable,str(ROOT/'scripts/check_skill_policy.py')],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    def test_role_map(self):
        d=json.loads((ROOT/'policy/skill-routing.json').read_text())
        self.assertEqual(set(d['roles']),{'manager','frontend','backend','database','security','reviewer','optimizer','tester'})
    def test_no_unknown_sources(self):
        d=json.loads((ROOT/'policy/skill-sources.json').read_text())
        self.assertTrue(all(v['url'].startswith('https://') for v in d['sources'].values()))
