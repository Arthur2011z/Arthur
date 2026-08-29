# Beach-Volleyball 2 gegen 2

Top-Down-Beachvolleyball für Handy, Tablet und Desktop. Reines HTML5 Canvas +
TypeScript, kein Game-Framework. Das Feld dreht sich mit dem Bildschirmformat:
im Hochformat liegt das Netz waagerecht, im Querformat senkrecht.

## Entwicklung

```bash
npm install
npm run dev        # lokaler Dev-Server mit Hot-Reload
npm run typecheck  # nur Typprüfung
npm run build      # erzeugt dist/index.html als einzelne, eigenständige Datei
npm run preview    # den Production-Build lokal ansehen
npm test           # Playwright-Tests gegen den Build
```

`npm run build` bündelt alles zu **einer** self-contained `dist/index.html` —
kein externer Request, die Datei lässt sich direkt öffnen oder verteilen.

## Steuerung

Das Spiel erkennt selbst, ob zuletzt eine Taste gedrückt oder der Bildschirm
berührt wurde, und blendet die passende Bedienung ein.

| | Tastatur | Touch |
|---|---|---|
| Laufen | W A S D | Steuerknüppel unten links |
| Pass zum Mitspieler | E | Pass |
| Notfall-Schlag übers Netz | F | Notfall |
| Block am Netz | Leertaste | Block |
| Schmettern / Aufschlag | Q | Schmettern bzw. Aufschlag |

Loslassen stoppt sofort — es gibt nirgends Nachgleiten.

**Schmetterschlag**: Q hebt ab. Am höchsten Punkt läuft die Welt in Zeitlupe und
eine leuchtende Linie zeigt die tatsächliche Flugbahn; W A S D (bzw. Wischen)
steuern sie, ein zweites Q schlägt zu. Die Kraft kommt vor allem daraus, wie nah
am Netz du abgesprungen bist.

**Aufschlag**: Während du aufschlägst, verschwinden alle anderen Knöpfe und du
kannst dich nur seitlich entlang der Grundlinie bewegen. Erster Druck wirft den
Ball hoch und springt ab, zweiter Druck schlägt. Kein zweiter Druck heißt
Aufschlagfehler.

## Regeln

Echte Volleyballregeln, kein vereinfachtes Modell:

- Drei Ballkontakte pro Team, dann muss der Ball über das Netz.
- Kein Spieler darf zweimal direkt hintereinander berühren — aber derselbe
  Spieler darf den 1. und den 3. Kontakt nehmen.
- Ein Block kostet keinen Kontakt, und der Blocker darf den nächsten Ball
  spielen (Hallen-Regel).
- Das Netz ist 2,24 m hoch und ein echtes Hindernis: ein zu flacher Ball bleibt
  darin hängen.
- Bälle können ins Aus gehen. Nichts hält sie künstlich im Feld.
- Rally-Point bis 21, Sieg mit zwei Punkten Vorsprung. Wer den Ballwechsel
  gewinnt, schlägt auf; nur ein Team, das den Aufschlag *zurückgewinnt*,
  wechselt seinen Aufschläger.

## Wie es innen aufgebaut ist

**Der Ball ist ein echtes Wurfgeschoss.** Er hat Position und Geschwindigkeit
und fällt unter Schwerkraft; nichts bewegt ihn auf einen vorher festgelegten
Landepunkt zu. Deshalb ist die Flugbahn eine echte Parabel, deshalb kann ein
Schlag wirklich daneben gehen, und deshalb ist die Zielvorschau nicht eine
Skizze des Schlags, sondern der Schlag selbst — sie entsteht, indem derselbe
Integrator vorwärts laufen gelassen wird (`Physics.simulate`).

**Ein Tastendruck berührt den Ball nie.** Er legt eine Absicht ab. Eingelöst
wird sie ausschließlich in dem Physik-Teilschritt, in dem sich die Hitboxen
tatsächlich überschneiden — für Pass, Notfall, Block, Schmetterschlag und
Aufschlag gleichermaßen. Einen anderen Weg von der Eingabe zur Ballbewegung
gibt es im Code nicht. Integriert wird in festen 1/240-Sekunden-Schritten, damit
auch ein 20 m/s schneller Ball durch niemanden hindurchtunneln kann.

**Debug-Logging** schreibt für jede Aktion mit, wann gedrückt, wann physisch
berührt und wann ausgeführt wurde. Berührung und Ausführung müssen immer
identisch sein. Einschalten mit `?debug=1` in der URL oder `window.__debug = true`.

**Die KI** ist eine Klasse mit zwei Kennzahlen-Profilen. Verteidigungs- und
Angriffswerte werden von getrennten Code-Pfaden gelesen und nirgends
miteinander verrechnet — die Gegner verteidigen gut, ohne dadurch besser
anzugreifen. Ihre Fehler im Angriff entstehen aus schlechterer Zielwahl und
größerer Streuung, nicht aus einem versteckten „dieser Schlag ist ein Fehler".
