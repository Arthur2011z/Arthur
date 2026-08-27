# Beach-Volleyball

Mobile-first 2D-Top-Down-Beachvolleyball (2 gegen 2) für Touch-Bedienung auf Handy und
Tablet. Reines HTML5 Canvas + TypeScript, kein Game-Framework. Ein Spieler (Nutzer) plus
KI-Mitspieler gegen zwei KI-Gegner.

## Entwicklung

```bash
npm install
npm run dev        # lokaler Dev-Server mit Hot-Reload
npm run typecheck  # nur Typprüfung
npm run build       # erzeugt dist/index.html als einzelne, eigenständige Datei
npm run preview     # den Production-Build lokal ansehen
npm test            # Playwright-Tests (mobile Touch-Emulation)
```

`npm run build` bündelt die App zu **einer** self-contained `dist/index.html` (kein
externer Request, alles inline) — diese Datei lässt sich direkt öffnen oder als
eigenständige Seite verteilen.

## Steuerung

- **Steuerknüppel** (unten links): freie Bewegung in der eigenen Feldhälfte. Stoppt
  sofort beim Loslassen.
- **Block-Knopf**: stellt an Ort und Stelle eine Blockwand am Netz auf. Der Knopf
  bewegt den Spieler keinen Zentimeter — er fängt nur dann etwas ab, wenn der Spieler
  ohnehin schon nah genug am Netz steht (1,5 m). Ein gegnerischer Angriffsschlag, der
  in diesem Moment durch die Blockzone kommt, prallt hart und steil direkt zurück auf
  die Seite des Angreifers — ausdrücklich keine normale Ballannahme. Ein hoher Lob
  segelt über den Block hinweg, ein kurzer Ball geht darunter durch: der Block schlägt
  Angriffe, keine Bälle mit Bogen. Es gibt kein Nachlaufen und keine Erholungspause;
  während des Blocks ist keine andere Aktion möglich.
- **Sprung-Schmetterschlag** (großer Haupt-Button): funktioniert von überall auf dem
  Feld, springt sofort. Trifft der Ball den Spieler in der Luft, tritt eine kurze,
  deutlich spürbare Zeitlupe ein (Spieler *und* Ball synchron verlangsamt) — währenddessen
  einen **Ziel-Wisch** machen, um die Schlagrichtung des harten Schmetterschlags zu
  bestimmen. Ohne Wisch fliegt der Schlag geradeaus übers Netz. Je weiter der Spieler
  beim Absprung vom Netz entfernt war, desto höher das Risiko, dass der Schlag ins
  Netz geht.
- **Pass-Knopf** (großer Haupt-Button): kontrollierter Pass zum KI-Mitspieler. Kann
  vorgehalten werden — die KI übernimmt die Feinbewegung zum Ball, der eigentliche
  Kontakt passiert erst, wenn der Ball wirklich in Reichweite ist.
- **Notfall-Schlag** (kleiner Button): einfacher, schwacher Schlag übers Netz von
  überall, ohne Sprung — die Notlösung, wenn der Spieler in Bedrängnis ist.
- **Aufschlag-Knopf**: erscheint nur im Aufschlag-Modus, und dann als **einziger**
  Knopf — die vier normalen Aktions-Knöpfe sind so lange komplett ausgeblendet.
  Ein Druck startet die ganze Routine von selbst: Ball wird senkrecht hochgeworfen,
  der Spieler springt hinterher, und oben öffnet sich dieselbe Zeitlupe mit derselben
  Flugbahn-Vorschau wie beim Schmetterschlag. Während der Aufschlag-Vorbereitung kann
  sich der Spieler ausschließlich seitlich entlang der eigenen Grundlinie bewegen;
  die Seitenlinien sind eine feste Wand. Sobald der Ball geschlagen ist, blendet die
  Oberfläche sofort zurück auf die vier normalen Knöpfe.

Gewischt wird ausschließlich für die Ziel-Richtung während der Zeitlupe (Schmetter-
schlag **und** Aufschlag) — sonst nirgends.

### Tastatur

Touch und Tastatur sind gleichzeitig aktiv, keins schaltet das andere ab.

| Taste | Aktion |
| --- | --- |
| `W` `A` `S` `D` | Laufen; in der Luft bestimmen sie stattdessen die Schlagrichtung |
| `Leertaste` | Block |
| `Q` | erster Druck: Sprung — zweiter Druck in der Luft: Schmetterschlag-Treffer |
| `E` | Pass |
| `F` | Notfall-Schlag |

Im Aufschlag-Modus lösen `Leertaste` und `Q` stattdessen den Aufschlag aus, und
`A`/`D` schieben den Spieler seitlich an der Grundlinie entlang (`W`/`S` tun nichts).

## Spielregeln

- **3-Kontakte-Regel**: jedes Team darf den Ball höchstens dreimal berühren, bevor er
  zurück übers Netz muss. Beim Pflicht-Endkontakt wandelt sich ein gedrückter
  Pass-Button automatisch in einen Schlag übers Netz um; auch der KI-Mitspieler setzt
  dann zwingend übers Netz statt zum Spieler vor.
- **Netz-Regel**: kein Spieler (beide Teams) darf während des normalen Spiels über die
  Netzlinie in die gegnerische Hälfte laufen.
- **Echtes Aufschlag-System**: nach jedem Punkt Aufschlagwechsel an das Team, das den
  letzten Punkt gewonnen hat. Bei eigenem Aufschlag geht das Spiel in einen eigenen
  Aufschlag-Zustand mit eigener Oberfläche (siehe Aufschlag-Knopf oben); der Ball
  bleibt in der Hand des Spielers, bis aufgeschlagen wird (oder ein Fallback-Timeout
  die Routine von selbst startet). Der Aufschlagschlag ist ein normaler
  Sprung-Schmetterschlag: Wisch-Distanz bestimmt die Kraft, es gibt Streuung, und ein
  zu weit gezogener Aufschlag geht regulär ins Aus — ohne jede automatische Korrektur.
  Einzige Ausnahme zum Schmetterschlag: das Netzfehler-Risiko entfällt beim Aufschlag
  (er wird zwangsläufig von der Grundlinie geschlagen, wo dieses Risiko am höchsten
  wäre), und die Ziel-Reichweite hat eine eigene, auf die Grundlinien-Distanz
  angepasste Spanne.
- **Blocken**: sobald das eigene Team den Ball übers Netz gespielt hat, baut der Gegner
  einen Angriff auf. Der KI-Mitspieler erkennt das selbstständig, läuft von sich aus ans
  Netz auf die Spalte des Balls und stellt den Block, sobald ein harter Angriff kommt —
  ohne dass der Spieler etwas drückt. Der Spieler kann sich dadurch nach hinten in die
  Feldverteidigung zurückziehen. Bei einem langsamen Lob bricht die KI den Block ab und
  nimmt den Ball stattdessen regulär an. Es blockt immer nur einer von beiden: blockt der
  Spieler selbst, bleibt der Mitspieler im Feld.
- **KI-Mitspieler**: deckt dynamisch die Zone (Netz vs. hinten) ab, in der sich der
  Spieler gerade *nicht* befindet — keine starre Grundposition. Reagiert nur, wenn der
  Ball wirklich in seine Nähe kommt oder auf ihn zufliegt. Legt fast immer zum Spieler
  vor (für dessen Schmetterschlag), statt selbst übers Netz zu spielen — außer bei
  einem zu schnellen/direkten Ball oder dem Pflicht-Endkontakt, dann Notlösung übers
  Netz. Kehrt danach zur aktuellen Zielzone zurück.
- **Gegner-KI** (2 Spieler): der näher am Ball stehende Gegner spielt automatisch
  zurück. Meistens ein sicherer Rückschlag, gelegentlich ein spürbar schnellerer,
  aggressiverer Angriff, seltener ein Fehler (Ball landet im Netz auf der eigenen
  Seite) — insgesamt bewusst schlagbar statt eine unüberwindbare Mauer.
- **Landepunkt-Anzeige**: Kreuz/Kreis am Boden zeigt an, wo ein fliegender Ball landen
  wird.
- **Punktesystem**: Rally-Point-Zählung bis 21, Gewinn mit 2 Punkten Vorsprung. Nach
  Spielende erscheint ein "Neu starten"-Button.

## Baufortschritt

Das Spiel ist in kleinen, einzeln testbaren Schritten entstanden (siehe
Commit-Historie):

1. Steuerknüppel-Bewegung
2. Ballphysik (saubere Parabel-Flugbahn, konsistent über die gesamte Flugzeit)
3. Eingabe-Schicht: Wisch-Geste + Sprung-Schmetterschlag-/Pass-/Notfall-Schlag-Buttons
4. Sprung-Schmetterschlag mit Zeitlupe + Netzrisiko, Notfall-Schlag, 3-Kontakte-Regel
5. KI-Mitspieler mit dynamischer Zonen-Abdeckung
6. Gegner-KI mit Angriff und Fehleranfälligkeit
7. Punktesystem (Rally-Point bis 21), echtes Aufschlagsystem, Netz-Kollision ✅ fertig
