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

## Baufortschritt

Das Spiel entsteht in kleinen, einzeln testbaren Schritten (siehe Commit-Historie):

1. Steuerknüppel-Bewegung
2. Wisch-Hechten mit automatischem Zuspiel zum KI-Mitspieler
3. Schlag-Knopf mit schwachem Zufallsschlag
4. Sprung-Knopf mit gezieltem Schmetterschlag am Netz
5. KI-Mitspieler-Logik mit Grundposition
6. Gegner-KI und Punktesystem (Rally-Point bis 21)
