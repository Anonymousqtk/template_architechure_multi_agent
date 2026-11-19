import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const here = dirname(fileURLToPath(import.meta.url));
const discovered = process.platform === 'win32' ? undefined : spawnSync('pg_config', ['--bindir'], {encoding:'utf8'});
const bin = process.env.PG_BIN || (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : (discovered?.status === 0 ? discovered.stdout.trim() : ''));
const executable = name => bin ? join(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
function run(name, args, input) {
  const r = spawnSync(executable(name), args, { input, encoding: 'utf8', windowsHide: true, ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}) });
  if (r.error || r.status !== 0) throw new Error(`${name}: ${r.error || r.stderr || r.stdout}`);
  return r.stdout;
}
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const directory = mkdtempSync(join(tmpdir(), 'managerhr-migration-test-'));
let started = false;
try {
  run('initdb', ['-D', directory, '-U', 'migration_test', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', directory, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  started = true;
  const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'migration_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  for (const file of readdirSync(join(here, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    if (file.startsWith('003_')) run('psql', args, readFileSync(join(here, 'upgrade-before.sql'), 'utf8'));
    run('psql', args, readFileSync(join(here, 'migrations', file), 'utf8'));
    if (file.startsWith('003_')) {run('psql', args, readFileSync(join(here, 'upgrade-after.sql'), 'utf8'));console.log('PASS existing AUTH-001 data preserved during RBAC upgrade');}
    console.log(`PASS migration ${file}`);
  }
  run('psql', args, readFileSync(join(here, 'verify.sql'), 'utf8'));
  console.log('PASS PostgreSQL migration constraints and rollback verification');
  if (process.env.MIGRATION_TEST_BACKEND === 'true') {
    const result = spawnSync(process.execPath, [join(here, '../backend/node_modules/vitest/vitest.mjs'), 'run', '--coverage'], {
      encoding: 'utf8', windowsHide: true, cwd: join(here, '../backend'),
      env: { ...process.env, DATABASE_URL: `postgresql://migration_test@127.0.0.1:${port}/postgres`, NODE_ENV: 'test' }
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error || result.status !== 0) throw new Error(`Backend integration test failed: ${result.error || result.status}`);
  }
} finally {
  if (started) run('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop']);
  // Only remove the directory returned directly by mkdtempSync under OS temp.
  rmSync(directory, { recursive: true, force: true });
}



