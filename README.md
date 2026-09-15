# Website Arthur Gittel

Websites für kleine Betriebe im Kreis Stormarn.

Eine einzelne Seite zum Scrollen, dazu Impressum und Datenschutz als
Unterseiten. Reines HTML und CSS, kein Build-Schritt, keine Abhängigkeiten.
Hochladen genügt.

## Dateien

```
index.html              die Seite selbst
css/style.css           die gesamte Gestaltung
img/                    drei Illustrationen als SVG
impressum/index.html    Impressum
datenschutz/index.html  Datenschutzerklärung
robots.txt              Anweisung für Suchmaschinen
sitemap.xml             Seitenverzeichnis für Suchmaschinen
OFFENE-PUNKTE.md        was vor dem Livegang noch einzutragen ist
```

Die Unterseiten liegen als `index.html` in eigenen Ordnern. Dadurch sind sie
unter `/impressum` und `/datenschutz` erreichbar, ohne `.html` am Ende und
ohne Servereinstellungen.

## Veröffentlichen mit GitHub Pages

1. Alle Dateien in ein neues Repository hochladen, direkt im Hauptordner —
   **nicht** in einen Unterordner.
2. Im Repository auf **Settings** → **Pages**.
3. Bei *Source* **Deploy from a branch** wählen, als Branch `main` und als
   Ordner `/ (root)`.
4. Speichern. Nach ein bis zwei Minuten ist die Seite unter
   `https://<benutzername>.github.io/<repository>/` erreichbar.

Eine eigene Domain lässt sich später unter *Settings* → *Pages* →
*Custom domain* eintragen.

## Vor dem Livegang

**Das Kontaktformular funktioniert noch nicht.** Es fehlt der Zugangsschlüssel
für den Versanddienst Web3Forms. Ohne ihn sieht ein Besucher zwar eine
Bestätigung, die Nachricht kommt aber nirgends an.

Ebenso fehlen die Anschrift im Impressum, der Hosting-Anbieter in der
Datenschutzerklärung und die echte Domain an vier Stellen.

Alles einzeln aufgelistet, mit Datei und Zeilennummer: siehe
`OFFENE-PUNKTE.md`.

## Technisches

- Läuft im dunklen und im hellen Modus, richtet sich nach der Einstellung des
  Geräts
- Geprüft ab 320 Pixel Breite
- JavaScript wird nur für die Rückmeldung des Kontaktformulars verwendet.
  Ohne JavaScript ist die gesamte Seite sichtbar und das Formular wird ganz
  normal abgeschickt
- Sichtbarer Fokusrahmen für Tastaturbedienung, `prefers-reduced-motion` wird
  beachtet
- Die Schrift Archivo wird von Google Fonts geladen, ohne das Anzeigen der
  Seite zu verzögern
