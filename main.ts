// main.ts — Emberline's entry program (Node 22, standard library only).
// The game itself is plain static files under game/ (three.js comes from the
// kit's vendored build, mapped by index.html's import map), and the
// screenshots under screenshots/ are real renders of that code. This program
// hands both in: it copies game/ and screenshots/ beside this file into the
// output directory and writes dossier.json there with the kit's vendored
// buildDossier, which is what the judge reads.
//
// Grader: /output. Anywhere else: MAKEFUN_OUTPUT_DIR.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Play it locally first with `node serve.ts` (http://localhost:8080).

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Start from a clean output directory so a stale file from an earlier run
// can never leak into the entry (and so two runs write identical bytes).
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// Caps from the competition's gate reference: the dossier text cap is the
// only one that shapes bytes; the rest refuse entries the scorer refuses.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
