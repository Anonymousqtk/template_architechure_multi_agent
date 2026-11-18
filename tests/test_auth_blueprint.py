import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
class AuthBlueprint(unittest.TestCase):
    def test_task_is_high_risk(self):
        task=json.loads((ROOT/'.agent-task.json').read_text())
        self.assertEqual(task['risk'], 'high')
        self.assertTrue(task['security_review_required'])
    def test_no_public_register_contract(self):
        text=(ROOT/'contracts/api.md').read_text()
        self.assertIn('No public `POST /api/auth/register`',text)
        self.assertIn('/api/auth/invitations/accept',text)
    def test_sql_proposal_has_critical_constraints(self):
        sql=(ROOT/'database/migrations/001_auth_invitation_schema.sql').read_text()
        for term in ['token_hash char(64) NOT NULL UNIQUE','UNIQUE (user_id, organization_id)',"role IN ('EMPLOYEE','HR')",'user_sessions']:
            self.assertIn(term,sql)
    def test_security_matrix_present(self):
        table=(ROOT/'docs/AUTH-TEST-MATRIX.md').read_text()
        for token in ['AUTH-07','AUTH-14','AUTH-18','AUTH-21']:
            self.assertIn(token,table)
if __name__=='__main__': unittest.main()
