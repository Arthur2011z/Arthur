# Beach-Volleyball

Mobile-first 2D-Top-Down-Beachvolleyball (2 gegen 2) für Touch-Bedienung auf Handy und
Tablet. Reines HTML5 Canvas + TypeScript, kein Game-Framework.

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

- **Steuerknüppel** unten links: freies Laufen in der eigenen Feldhälfte.
- **Wischen** auf dem Spielfeld in Ballrichtung: Hechtsprung, wenn der Ball zu weit
  weg ist, um normal hinzulaufen.
- **Schlag-Button**: Ballkontakt auslösen (schwacher Zufallsschlag ohne Sprung).
- **Sprung-Button** (nur aktiv nahe am Netz): Sprung, während dessen die
  Steuerknüppel-Richtung die Zielrichtung eines harten Schmetterschlags bestimmt.

## Spielregeln

- **KI-Mitspieler**: reagiert nur, wenn der Ball wirklich in seine Nähe kommt oder
  auf ihn zufliegt (auch nach einem Hechtsprung-Zuspiel). Kommt der Ball zu
  schnell/direkt, spielt er sofort eine Notlösung übers Netz; sonst stellt er ihn
  hoch zum menschlichen Spieler. Kehrt danach zur Grundposition zurück.
- **Gegner-KI** (2 Spieler): Der jeweils näher am Ball stehende Gegner läuft
  automatisch hin und spielt zurück; der andere bleibt an seiner Grundposition.
- **Punktesystem**: Rally-Point-Zählung bis 21, Gewinn mit 2 Punkten Vorsprung.
  Wer den letzten Punkt gewonnen hat, bekommt den nächsten Aufschlag. Nach
  Spielende erscheint ein "Neu starten"-Button.

## Baufortschritt

Das Spiel ist in kleinen, einzeln testbaren Schritten entstanden (siehe
Commit-Historie):

1. Steuerknüppel-Bewegung
2. Wisch-Hechten mit automatischem Zuspiel zum KI-Mitspieler
3. Schlag-Knopf mit schwachem Zufallsschlag
4. Sprung-Knopf mit gezieltem Schmetterschlag am Netz
5. KI-Mitspieler-Logik mit Grundposition
6. Gegner-KI und Punktesystem (Rally-Point bis 21) ✅ fertig
