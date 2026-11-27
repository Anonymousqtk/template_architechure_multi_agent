import importlib.util
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('claude_policy', ROOT / 'scripts/policy_check.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class ClaudeGovernanceTests(unittest.TestCase):
    def test_configuration_requires_high_risk_governance(self):
        for path in ('.claude/settings.json', '.claude/agents/security.md', 'CLAUDE.md'):
            with self.subTest(path=path):
                task = {
                    'id': 'GOV-TEST', 'summary': 'Claude governance',
                    'allowed_scopes': ['frontend'], 'risk': 'normal',
                    'security_review_required': True, 'acceptance': ['ok'],
                }
                errors = policy.validate([path], task)
                self.assertIn('Governance scope required for protected changes', errors)
                self.assertIn('Protected changes must declare high risk', errors)
                task.update(allowed_scopes=['governance'], risk='high')
                self.assertEqual(policy.validate([path], task), [])

    def test_claude_changes_trigger_all_ci_scopes(self):
        for path in ('.claude/settings.json', 'CLAUDE.md'):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'output'
                env = {'EVENT_NAME': 'pull_request', 'BASE_SHA': 'base',
                       'HEAD_SHA': 'head', 'GITHUB_OUTPUT': str(output)}
                with patch.dict(os.environ, env), patch('subprocess.check_output', return_value=path + '\n'):
                    runpy.run_path(str(ROOT / 'scripts/detect_changes.py'), run_name='__main__')
                self.assertEqual(dict(line.split('=') for line in output.read_text().splitlines()),
                                 dict.fromkeys(('frontend', 'backend', 'database', 'code', 'sast'), 'true'))

    def test_reviewers_have_no_execution_or_write_tools(self):
        for name in ('reviewer', 'security'):
            with self.subTest(name=name):
                text = (ROOT / f'.claude/agents/{name}.md').read_text(encoding='utf-8')
                frontmatter = dict(line.split(':', 1) for line in text.split('---', 2)[1].strip().splitlines())
                self.assertEqual({tool.strip() for tool in frontmatter['tools'].split(',')},
                                 {'Read', 'Grep', 'Glob'})
                self.assertEqual(frontmatter['model'].strip(), 'inherit')

    def test_read_exclusions_are_project_anchored(self):
        settings = json.loads((ROOT / '.claude/settings.json').read_text(encoding='utf-8'))
        rules = set(settings['permissions']['deny'])
        for directory in ('node_modules', 'coverage', 'dist', 'build', 'vendor', 'generated'):
            self.assertIn(f'Read(/**/{directory}/**)', rules)
        for pattern in ('/**/*.generated.*', '/**/*.min.*', '/**/*lock*', '/**/.env*',
                        '/backend/data/**', '/data/**'):
            self.assertIn(f'Read({pattern})', rules)

    def test_skills_reuse_existing_instructions(self):
        for path in (ROOT / '.claude/skills').glob('*/SKILL.md'):
            with self.subTest(skill=path.parent.name):
                target = f'.codex/skills/{path.parent.name}/SKILL.md'
                self.assertTrue((ROOT / target).is_file())
                text = path.read_text(encoding='utf-8')
                self.assertIn(target, text)
                self.assertNotIn('## Procedure', text)


if __name__ == '__main__':
    unittest.main()
