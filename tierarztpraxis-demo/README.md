# Tierarztpraxis Hamburg-Volksdorf — Gestaltungsdemo

Unbeauftragter Gestaltungsentwurf von Arthur Gittel. **Nicht die offizielle
Seite einer Praxis.** Die Demo dient als Arbeitsnachweis im Portfolio und als
etwas Fertiges, das im Gespräch gezeigt werden kann.

## Rechtsrahmen

Weil das Vorbild ein realer Betrieb ist, gelten harte Grenzen. Sie sind hier
dokumentiert, damit sie bei späteren Änderungen nicht versehentlich fallen:

- Es wurden **keine** Texte, Bilder, Grafiken oder Logos einer bestehenden
  Website übernommen. Alle Texte sind für diesen Entwurf neu verfasst.
- **Keine echten Kontaktdaten.** Telefon `+49 40 000000` und `+49 40 000001`,
  E-Mail `praxis@demo.example`, Anschrift „Musterweg 12" sind Platzhalter.
- **Keine Fotos echter Personen**, keine Tier-Stockfotos. Wo Bilder stünden,
  sind beschriftete Platzhalterflächen eingesetzt.
- Impressum und Datenschutz sind **bewusst nicht ausgefüllt** und benennen den
  Demonstrationscharakter.
- Der Demo-Hinweis steht sichtbar oben auf jeder Seite und erneut in der
  Fußzeile. Er wird nicht entfernt, nicht versteckt und ist nicht schließbar.
- Alle drei Seiten tragen `<meta name="robots" content="noindex, nofollow">`.
- Es gibt keine Terminbuchung und kein Kundenkonto — nur Information und Anruf.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Startseite, ein Scroller |
| `impressum.html` | Platzhalterseite |
| `datenschutz.html` | Platzhalterseite |
| `styles.css` | Design-Tokens und gesamtes Layout |
| `app.js` | Öffnungsstatus und Steuerung der Anrufleiste |
| `fonts/source-sans-3-latin.woff2` | Source Sans 3, SIL OFL 1.1, selbst gehostet |
| `playwright.config.ts` | eigene Testkonfiguration, getrennt vom Spiel im Repo |
| `tests/demo.spec.ts` | die zehn Testfälle |

Reines HTML/CSS/JS, kein Build. `index.html` lässt sich direkt im Browser
öffnen. Das Vite-Projekt im Wurzelverzeichnis bleibt unberührt.

## Farben

| Zweck | Wert |
|---|---|
| Grundfläche | `#FBFAF8` |
| Abgesetzte Fläche | `#F1EEE9` |
| Text | `#2E3330` |
| Gedämpfter Text | `#5F6663` |
| Grün (nur Fläche mit weißer Schrift) | `#3F7D62` |
| Grün dunkel (Textfarbe auf Hell) | `#2C5A46` |
| Notfall-Signalfarbe | `#B4432B` |

Die Signalfarbe kommt ausschließlich im Notfallbereich vor; ein Test prüft das
auf allen Seiten. Als **Textfarbe** wird immer `#2C5A46` verwendet, nie
`#3F7D62`: letzteres erreicht auf der abgesetzten Fläche nur 4.20:1 und würde
WCAG AA verfehlen.

## Öffnungsstatus

Der Status wird **berechnet**, nicht fest geschrieben. Die Zeiten stehen als
Datenobjekt in `app.js`; daraus entsteht „Jetzt geöffnet — bis 18 Uhr" oder
„Jetzt geschlossen — wieder morgen ab 9 Uhr". Grundlage ist die Uhrzeit des
Geräts. Ohne JavaScript zeigt die Seite einen neutralen Hinweis auf die
Sprechzeiten-Tabelle darunter; die Tabelle selbst ist immer vollständig da.

## Tests

```
npm ci
npx playwright test --config=tierarztpraxis-demo/playwright.config.ts
```

Die Tests starten selbst einen lokalen Server auf Port 8765 und messen im
Browser statt zu schätzen: Sichtbarkeit ohne Scrollen bei 380 px, `tel:`-Links,
Tabellenbreite bei 320 und 380 px, Sprunglink, Vorkommen der Signalfarbe,
Kontrastwerte, Demo-Hinweis und `noindex` auf allen Seiten, fremde Requests
sowie Ladezeit.
