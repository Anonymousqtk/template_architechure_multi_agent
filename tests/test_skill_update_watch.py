import importlib.util
from pathlib import Path
import unittest

P=Path(__file__).resolve().parents[1]/'scripts/check_skill_updates.py'
spec=importlib.util.spec_from_file_location('skill_watch',P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SkillWatchTests(unittest.TestCase):
    def test_release_update(self):
        item={'id':'asvs','repository':'OWASP/ASVS','tracking':'release','approved_ref':'v5.0.0'}
        def fake(url, token):
            self.assertTrue(url.startswith('https://api.github.com/repos/OWASP/ASVS/'))
            return {'tag_name':'v5.1.0','html_url':'https://github.com/OWASP/ASVS/releases/tag/v5.1.0','draft':False,'prerelease':False}
        self.assertEqual(m.check_one(item,fake)['status'],'update-available')
    def test_needs_baseline(self):
        item={'id':'skills','repository':'openai/skills','tracking':'commit','approved_ref':None}
        self.assertEqual(m.check_one(item,lambda u,t:{'sha':'abcdef','html_url':'https://github.com/openai/skills/commit/abcdef'})['status'],'needs-baseline')
    def test_reject_invalid_repo(self):
        with self.assertRaises(ValueError):
            m.check_one({'id':'bad','repository':'../oops','tracking':'commit'},lambda u,t:{})

if __name__=='__main__': unittest.main()
