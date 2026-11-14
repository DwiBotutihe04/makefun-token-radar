// Token Radar, model radar-2. It reads the sealed snapshot, scores every pre-token protocol
// that could plausibly launch, and writes out the ranked board, the dashboard data, the
// dashboard itself, its screenshots, and the dossier the judge reads.
//
// Run it the grader's way, with the snapshot mounted at /input and output at /output:
//   node main.ts
// Or locally, against the kit's snapshot:
//   node main.ts --input ../input/snapshot.json --output out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The snapshot is the only input: this program makes no network calls. The dashboard and the
// screenshots ship from this repository, and the dossier is built from the output directory by
// the kit's own buildDossier, exactly as the rules require.

import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, checkBoard, dashboardScript, moneyShort, readSnapshot, valueFull } from './lib/model.ts';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The value of `--flag value` or `--flag=value`, if the flag was passed. */
function flagValue(flag: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === flag && i + 1 < argv.length) return argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

/** Find the snapshot: the flag first, the grader's mounts next, the kit's input last. */
function findSnapshot(): string {
  const given = flagValue('--input');
  if (given) return resolve(given);
  for (const mount of ['/input/snapshot.json', '/app/input/snapshot.json']) {
    if (existsSync(mount)) return mount;
  }
  return resolve(here, '../input/snapshot.json');
}

/** Find the output directory: the flag first, the environment next, the grader's mount last. */
function findOutput(): string {
  const given = flagValue('--output');
  if (given) return resolve(given);
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env) return resolve(env);
  return '/output';
}

/** Copy the plain files of `src` into `dest` and return the names copied. */
function copyFiles(src: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    copyFileSync(join(src, entry.name), join(dest, entry.name));
    names.push(entry.name);
  }
  return names;
}

function run(): void {
  const snapshot = readSnapshot(JSON.parse(readFileSync(findSnapshot(), 'utf8')));
  const outDir = findOutput();
  const { board, data } = buildBoard(snapshot);
  const problem = checkBoard(board, snapshot.watchlist);
  if (problem !== null) throw new Error(`board failed the gate: ${problem}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, 'data.js'), dashboardScript(data), 'utf8');
  const dashboardNames = copyFiles(join(here, 'dashboard'), join(outDir, 'dashboard'));
  const shotNames = copyFiles(join(here, 'screenshots'), join(outDir, 'screenshots'));

  // buildDossier hands back the dossier bytes: write them unchanged. The scorer rebuilds the
  // dossier from this output with the same call and compares bytes, so this call stays as it is.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const best = board[0]!;
  const boardSize = statSync(join(outDir, 'board.json')).size;
  const dossierSize = statSync(join(outDir, 'dossier.json')).size;
  console.log(
    `radar built from ${snapshot.protocols.length} protocols: ${board.length} rows, ` +
      `${snapshot.watchlist.length} of them watchlist, ${board.length - snapshot.watchlist.length} early, ` +
      `${data.live_size} live ones set aside`,
  );
  console.log(
    `top of the board: ${best.name} at ${valueFull(best.implied_value_usd)} implied ` +
      `(${moneyShort(best.tvl_usd)} of TVL, sector multiple ${best.model.sector_multiple})`,
  );
  console.log(
    `wrote ${join(outDir, 'board.json')} (${boardSize} bytes), ${join(outDir, 'data.js')}, ` +
      `${dashboardNames.length} dashboard files, ${shotNames.length} screenshots, ` +
      `and ${join(outDir, 'dossier.json')} (${dossierSize} bytes)`,
  );
}

run();
