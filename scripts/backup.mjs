/**
 * Database backup.
 *   npm run backup
 *
 * SQLite: makes a consistent copy using the sqlite3 backup API when the
 * sqlite3 CLI is available, and falls back to a file copy otherwise. Keeps the
 * last 30 files in ./backups.
 * PostgreSQL: prints the pg_dump command to run (dumping is the database
 * server's job, not the app's).
 */
import { mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const KEEP = 30;
const OUT = 'backups';

function envUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith('DATABASE_URL='));
    if (line) return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

const url = envUrl();
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

if (!url.startsWith('file:')) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log('This database is not SQLite. Run:');
  console.log(`  pg_dump "${url}" -Fc -f ${OUT}/restropos-${stamp}.dump`);
  process.exit(0);
}

// Prisma resolves relative SQLite paths against the prisma/ directory.
const raw = url.replace(/^file:/, '');
const dbPath = raw.startsWith('/') ? raw : resolve('prisma', raw);
if (!existsSync(dbPath)) {
  console.error(`No database file at ${dbPath}. Run "npm run db:push" first.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(OUT, `restropos-${stamp}.db`);

try {
  // .backup is safe to run while the app is serving traffic; a plain copy of a
  // live SQLite file can catch it mid-write.
  execFileSync('sqlite3', [dbPath, `.backup '${target}'`], { stdio: 'pipe' });
  console.log(`Backed up with sqlite3 -> ${target}`);
} catch {
  copyFileSync(dbPath, target);
  console.log(`sqlite3 not found; copied the file instead -> ${target}`);
  console.log('Install sqlite3 for hot backups: sudo apt install sqlite3');
}

const old = readdirSync(OUT)
  .filter((f) => f.startsWith('restropos-') && f.endsWith('.db'))
  .map((f) => ({ f, t: statSync(join(OUT, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)
  .slice(KEEP);

for (const { f } of old) {
  unlinkSync(join(OUT, f));
  console.log(`Removed old backup ${f}`);
}
