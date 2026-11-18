import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('policy_check', ROOT / 'scripts/policy_check.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class PolicyTests(unittest.TestCase):
    def task(self, **changes):
        data = {'id':'TASK-1', 'summary':'test', 'allowed_scopes':['backend'],
                'risk':'normal', 'security_review_required':False, 'acceptance':['ok']}
        data.update(changes)
        return data

    def test_normal_backend(self):
        self.assertEqual(policy.validate(['backend/src/app.ts', '.agent-task.json'], self.task()), [])

    def test_reject_undeclared_scope(self):
        self.assertTrue(policy.validate(['frontend/src/a.ts'], self.task()))

    def test_sensitive_requires_high_risk_and_security(self):
        self.assertTrue(policy.validate(['backend/auth/login.ts'], self.task()))
        self.assertEqual(policy.validate(['backend/auth/login.ts'], self.task(risk='high', security_review_required=True)), [])

    def test_protected_requires_governance_and_high(self):
        self.assertTrue(policy.validate(['.github/workflows/ci.yml'], self.task()))
        self.assertEqual(policy.validate(['.github/workflows/ci.yml'], self.task(allowed_scopes=['governance'],risk='high')), [])

    def test_documentation_only_exempt(self):
        self.assertEqual(policy.validate(['docs/progress.md'], None), [])

    def test_manifest_missing_fails_code(self):
        self.assertTrue(policy.validate(['backend/src/app.ts'], None))

if __name__ == '__main__':
    unittest.main()
