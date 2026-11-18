import json,subprocess,sys,tomllib,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class TestModelPolicy(unittest.TestCase):
 def test_policy_check(self):
  p=subprocess.run([sys.executable,str(ROOT/'scripts/check_model_policy.py')],capture_output=True,text=True)
  self.assertEqual(p.returncode,0,p.stderr)
 def test_profile_preview_does_not_modify(self):
  before=(ROOT/'.codex/agents/frontend.toml').read_bytes()
  p=subprocess.run([sys.executable,str(ROOT/'scripts/apply_model_profile.py'),'--profile','inherit'],capture_output=True,text=True)
  self.assertEqual(p.returncode,0,p.stderr)
  self.assertEqual(before,(ROOT/'.codex/agents/frontend.toml').read_bytes())
 def test_unsupported_unconfirmed_profile_rejected(self):
  p=subprocess.run([sys.executable,str(ROOT/'scripts/apply_model_profile.py'),'--profile','example'],capture_output=True,text=True)
  self.assertNotEqual(p.returncode,0)
 def test_roles_defined(self):
  policy=json.loads((ROOT/'policy/model-routing.json').read_text())
  self.assertEqual(len(policy['roles']),7)
  self.assertEqual(policy['max_parallel_subagents'],2)
if __name__=='__main__': unittest.main()
