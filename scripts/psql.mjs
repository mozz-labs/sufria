/**
 * تشغيل psql بدون ما نجبر كل واحد بالفريق ينصّب psql على جهازه.
 *
 * الترتيب:
 *   1. لو psql موجود على الجهاز -> بنستخدمه مباشرة (هيك بتشتغل على GitHub Actions)
 *   2. لو مش موجود -> بنشغّله جوا كونتينر Postgres نفسه عبر docker compose exec
 *
 * يعني على ويندوز: Docker + Node + pnpm بس. ولا شي تاني.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

export function hasLocalPsql() {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['psql'], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

/** @param {{sql?: string, file?: string, url?: string, quiet?: boolean}} opts */
export function psql(opts) {
  const url = opts.url ?? process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('لا يوجد DATABASE_URL. انسخ .env.example لـ .env أولا.');

  const args = ['-v', 'ON_ERROR_STOP=1'];
  if (opts.quiet) args.push('-q');

  if (hasLocalPsql()) {
    if (opts.file) args.push('-f', opts.file);
    if (opts.sql) args.push('-c', opts.sql);
    return spawnSync('psql', [url, ...args], { stdio: 'inherit' });
  }

  // داخل الكونتينر: localhost تبع الجهاز مش localhost تبع الكونتينر
  const inContainerUrl = url.replace(/@(localhost|127\.0\.0\.1):\d+/, '@localhost:5432');
  const dockerArgs = ['compose', 'exec', '-T', 'postgres', 'psql', inContainerUrl, ...args];

  if (opts.file) {
    if (!existsSync(opts.file)) throw new Error(`الملف غير موجود: ${opts.file}`);
    // ما في -f جوا الكونتينر لأن الملف عالجهاز — بنمرره على stdin
    return spawnSync('docker', dockerArgs, {
      input: readFileSync(opts.file),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  }
  return spawnSync('docker', [...dockerArgs, '-c', opts.sql], { stdio: 'inherit' });
}
