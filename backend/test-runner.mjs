import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Always create a fresh disposable cluster. Never test against caller DATABASE_URL.
const runner = fileURLToPath(new URL('../database/test-migrations.mjs', import.meta.url));
const result = spawnSync(process.execPath, [runner], {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, MIGRATION_TEST_BACKEND: 'true', DATABASE_URL: '' },
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
