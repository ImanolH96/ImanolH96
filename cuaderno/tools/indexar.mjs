#!/usr/bin/env node
// Regenerates cuaderno/contenido/index.json (GitHub Pages can't list folders, so the app reads this list).
// Run after adding, renaming or deleting a .md file:  node cuaderno/tools/indexar.mjs
import { readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'contenido');
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(root)
  .map((p) => relative(root, p).split('\\').join('/'))
  .filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md')
  .sort();
writeFileSync(join(root, 'index.json'), JSON.stringify(files, null, 2) + '\n');
console.log(`contenido/index.json: ${files.length} archivo(s)`);
