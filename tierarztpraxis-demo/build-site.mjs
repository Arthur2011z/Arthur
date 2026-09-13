/* Stellt das Verzeichnis zusammen, das Netlify ausliefert.
 *
 * Das Quellverzeichnis enthaelt auch Tests, Konfiguration und diese Skripte.
 * Veroeffentlicht wird nur, was die Seite wirklich braucht.
 *
 * Aufruf: node tierarztpraxis-demo/build-site.mjs
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const ziel = join(hier, 'dist');

rmSync(ziel, { recursive: true, force: true });
mkdirSync(join(ziel, 'fonts'), { recursive: true });

const dateien = [
  'index.html',
  'impressum.html',
  'datenschutz.html',
  'styles.css',
  'app.js',
  'fonts/source-sans-3-latin.woff2',
];
for (const datei of dateien) {
  cpSync(join(hier, datei), join(ziel, datei));
}

/* Suchmaschinen werden doppelt ausgesperrt: per robots.txt und per Header.
 * Der Header wirkt auch dann, wenn eine Seite direkt verlinkt aufgerufen wird. */
writeFileSync(join(ziel, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

writeFileSync(
  join(ziel, '_headers'),
  `/*
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
`
);

console.log(`${ziel} — ${dateien.length} Dateien, robots.txt und _headers`);
