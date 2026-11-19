import subprocess,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class TestTokenLean(unittest.TestCase):
 def test_policy(self):
  result=subprocess.run([sys.executable,str(ROOT/'scripts/check_token_lean.py')],capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
if __name__=='__main__': unittest.main()
