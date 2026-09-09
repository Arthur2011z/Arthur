/* Baut aus den einzelnen Dateien eine einzige HTML-Seite für die
 * Veröffentlichung als Artifact.
 *
 * Ein Artifact ist genau eine Seite. Impressum und Datenschutz können dort
 * keine eigenen Adressen haben und werden deshalb als Abschnitte an das Ende
 * gehängt; die Links in der Fußzeile springen dorthin.
 *
 * Die Schrift wird als data:-URI eingebettet, damit die Seite auch dort ohne
 * einen einzigen fremden Request auskommt — genau das behauptet ihr eigener
 * Datenschutztext.
 *
 * Aufruf: node tierarztpraxis-demo/build-artifact.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const lies = (name) => readFileSync(join(hier, name), 'utf8');

/* --- Schrift einbetten ---------------------------------------------------- */
const schrift = readFileSync(join(hier, 'fonts/source-sans-3-latin.woff2')).toString('base64');
const css = lies('styles.css').replace(
  /url\('fonts\/source-sans-3-latin\.woff2'\)/g,
  `url('data:font/woff2;base64,${schrift}')`
);

/* --- Rumpf der Startseite ------------------------------------------------- */
const rumpf = (datei) => {
  const treffer = /<body>([\s\S]*?)<\/body>/.exec(lies(datei));
  if (!treffer) throw new Error(`Kein <body> in ${datei}`);
  return treffer[1];
};

/* Rechtsseite in einen Abschnitt der einen Seite umwandeln. */
const rechtsseite = (datei, id, ueberschrift) => {
  const inhalt = /<main>([\s\S]*?)<\/main>/.exec(lies(datei));
  if (!inhalt) throw new Error(`Kein <main> in ${datei}`);
  return inhalt[1]
    .replace('<div class="huelle">', `<div class="huelle" id="${id}">\n      <h2>${ueberschrift}</h2>`)
    .replace(/<h2>/g, '<h3>')
    .replace(/<\/h2>/g, '</h3>')
    /* Die eingesetzte Ueberschrift wieder auf h2 zurueckdrehen. */
    .replace(`<h3>${ueberschrift}</h3>`, `<h2>${ueberschrift}</h2>`);
};

let seite = rumpf('index.html')
  /* Die Fusszeile verweist auf Abschnitte statt auf eigene Dateien. */
  .replace('href="impressum.html"', 'href="#impressum"')
  .replace('href="datenschutz.html"', 'href="#datenschutz"')
  /* Das externe Skript wird unten eingebettet. */
  .replace('<script src="app.js"></script>', '');

/* Die Rechtsabschnitte vor die Fusszeile setzen. */
const recht =
  rechtsseite('impressum.html', 'impressum', 'Impressum') +
  rechtsseite('datenschutz.html', 'datenschutz', 'Datenschutz');
seite = seite.replace('</main>', recht + '\n</main>');

const ausgabe = `<title>Praxisentwurf Volksdorf</title>
<style>
${css}
</style>
${seite}
<script>
${lies('app.js')}
</script>
`;

const ziel = join(hier, 'artifact.html');
writeFileSync(ziel, ausgabe);
console.log(`${ziel} — ${(Buffer.byteLength(ausgabe) / 1024).toFixed(1)} KB`);
