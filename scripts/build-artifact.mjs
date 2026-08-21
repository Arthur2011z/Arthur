// Strips the outer <!doctype>/<html>/<head>/<body> wrapper tags from the Vite
// single-file build so the remaining markup (title, meta, inlined style/script,
// body content) can be dropped directly into a Claude Artifact publish, which
// supplies its own document skeleton.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const src = readFileSync(path.join(distDir, 'index.html'), 'utf8');

const stripped = src
  .replace(/<!doctype[^>]*>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head[^>]*>/gi, '')
  .replace(/<\/?body[^>]*>/gi, '')
  .trim();

writeFileSync(path.join(distDir, 'artifact.html'), stripped + '\n');
console.log('Wrote dist/artifact.html');
