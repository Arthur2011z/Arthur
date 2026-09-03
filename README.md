# Wilde Rosen — Schwitzhütte in Wulfsdorf

Website für die Schwitzhütte „Wilde Rosen" in Wulfsdorf, Kreis Stormarn.
Eine Scrollseite mit einem Ziel: dass Menschen einen Termin anfragen.

Schlichtes HTML und CSS, kein Build-Schritt. Zum Ansehen genügt ein einfacher
lokaler Server im Projektordner:

```bash
python3 -m http.server 8000
# danach http://localhost:8000 im Browser öffnen
```

## Dateien

```
index.html            die Scrollseite
css/wilde-rosen.css   die Stildatei
bilder/               die Fotos (noch leer)
```

## Baufortschritt

- [x] Schritt 1 — Grundgerüst, Farben, Schriften, Sprungnavigation, Kopfbereich
      mit den sechs Auswahlkacheln
- [x] Schritt 2 — Was eine Schwitzhütte ist
- [x] Schritt 3 — Der Ablauf mit den vier Runden
- [ ] Schritt 4 — Wer wir sind
- [ ] Schritt 5 — Termine und Beitrag
- [ ] Schritt 6 — Was du mitbringst
- [ ] Schritt 7 — Bevor du kommst
- [ ] Schritt 8 — Häufige Fragen
- [ ] Schritt 9 — Anfragen (Formular und WhatsApp)
- [ ] Schritt 10 — Fußzeile, Impressum, Datenschutz

## Was noch fehlt

Diese Angaben liegen nicht vor und wurden **nicht** erfunden. Im Quelltext sind
die betreffenden Stellen als Platzhalter markiert und auf der Seite sichtbar.

- Alle Fotos: Feuer (Kopfbereich), Hütte mit Decken, Menschen am Feuer,
  Porträt der beiden. Richtwert vor dem Hochladen: höchstens 1600 Pixel
  Kantenlänge und 300 Kilobyte pro Bild, abgelegt unter `bilder/`.
- Uhrzeiten des Ablaufs und Gesamtdauer
- Was in den vier Runden inhaltlich passiert
- Die nächsten Termine und wie oft im Jahr
- Die Beitragsspanne
- Der persönliche Text über die beiden Betreiber
- Genaue Angaben zu Anfahrt und Parken
- Ob jeder etwas zum Essen mitbringt oder gekocht wird
- Impressumsdaten: vollständiger Name, Anschrift, E-Mail, Telefon
- Die WhatsApp-Nummer für den Direktlink
- Ein Zugangsschlüssel für den Formularversand (Web3Forms)

## Vor dem Livegang

- Impressum und Datenschutzerklärung müssen vorhanden und von jeder Seite
  erreichbar sein. Ohne beides ist die Seite abmahnfähig.
- Auf den Fotos darf keine fremde Person erkennbar sein, ohne dass ihr
  Einverständnis vorliegt.
- Alle sichtbaren Platzhalter (gestrichelte Kästen) müssen ersetzt sein.

## Gestaltungsvorgaben

Farben, Schriften und Maße stehen als Variablen am Anfang von
`css/wilde-rosen.css` und werden nicht durch andere ersetzt.

| Zweck | Wert |
|---|---|
| Grundfläche | `#0F1412` |
| Dunkelste Fläche | `#080B0A` |
| Glut, Akzent, Knöpfe | `#E4652B` |
| Dunkle Glut | `#8E2F12` |
| Rosenrot (Name) | `#C4708A` |
| Fließtext | `#A8A69C` |
| Überschriften | `#EDE7DC` |

Überschriften in Fraunces (300, 500), Fließtext in Karla (300, 400, 600) mit
17 Pixel, Zeilenhöhe 1.75 und höchstens 62 Zeichen Zeilenlänge.
