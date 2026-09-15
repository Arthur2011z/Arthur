# Offene Punkte — Website Arthur Gittel

Stand: 15. September 2026. Branch `claude/arthur-gittel-website-ev0629`.

Diese Liste enthält alles, was vor dem Livegang noch von Hand eingetragen
oder entschieden werden muss. Jeder Punkt nennt die Datei und die Zeile, in
der der Platzhalter steht.

Nichts davon habe ich erfunden oder geschätzt — überall, wo eine echte Angabe
fehlt, steht ein sichtbarer Platzhalter statt eines Fantasiewerts.


## Teil 1 — Zwei Entscheidungen, die nur du treffen kannst

### 1.1 Widerspruch: „Zwei Runden Änderungen" gegen „Korrekturen im Umfang"

Auf der Seite stehen zurzeit zwei verschiedene Zusagen zum selben Thema:

| Ort | Wortlaut |
|---|---|
| `index.html`, Zeile 222 (Ablauf, Schritt 4) | „Ihr sagt, was anders soll. Zwei Runden Änderungen gehören dazu." |
| `index.html`, Zeile 348 (Karte Silber) | „Korrekturen innerhalb des vereinbarten Umfangs sind inklusive" |

Zwei feste Runden sind etwas anderes als unbegrenzte Korrekturen innerhalb des
Umfangs. Ein Kunde, der beides liest, weiß nicht, was gilt.

Ich habe die Stelle im Ablauf bewusst nicht angefasst, weil du sie früher
ausdrücklich als unveränderlich markiert hattest.

**Deine Entscheidung:**

- [ ] Es gelten **zwei Runden** → ich passe die Silber-Karte an
- [ ] Es gelten **Korrekturen im vereinbarten Umfang** → ich passe Schritt 4 an
- [ ] Etwas Drittes: ______________________________________________


### 1.2 Was passiert, wenn eine Änderung länger dauert als das Guthaben?

Das Änderungsguthaben ist beschrieben (eine Stunde im Monat, ansparbar bis
drei Stunden). Nicht beschrieben ist, was passiert, wenn eine gewünschte
Änderung mehr Zeit braucht, als angespart ist.

Ein Kunde wird das früher oder später fragen. Solange du es nicht festgelegt
hast, schreibe ich dazu nichts auf die Seite.

**Mögliche Regelungen, such dir eine aus oder nenn eine eigene:**

- [ ] Ich sage vorher Bescheid und wir vereinbaren einen Extrapreis
- [ ] Die Änderung wird auf mehrere Monate verteilt
- [ ] Zusätzliche Zeit kostet einen festen Stundensatz von ______ €
- [ ] Eigene Regelung: ____________________________________________


## Teil 2 — Angaben, die eingetragen werden müssen

### 2.1 Web3Forms-Zugangsschlüssel (Kontaktformular)

**Ohne diesen Schlüssel kommt keine einzige Anfrage bei dir an.** Das ist der
wichtigste Punkt der ganzen Liste.

- Datei: `index.html`, Zeile 477
- Steht dort: `value="TODO-WEB3FORMS-ACCESS-KEY-EINTRAGEN"`

So kommst du an den Schlüssel: auf web3forms.com die Adresse
`arthur.gittel@icloud.com` eintragen, den Schlüssel per Mail zuschicken lassen
und bei `value` einsetzen.

Einzutragen: _______________________________________________________


### 2.2 Anschrift fürs Impressum

Gesetzlich vorgeschrieben, bevor die Seite geschäftlich online geht.

- Datei: `impressum/index.html`, Zeilen 41 und 42
- Steht dort: `Straße und Hausnummer: TODO — noch einzutragen`
  und `PLZ und Ort: TODO — noch einzutragen`

Straße und Hausnummer: ______________________________________________

PLZ und Ort: ________________________________________________________


### 2.3 Erziehungsberechtigter im Impressum

- Datei: `impressum/index.html`, Zeilen 31 und 55

Da Arthur minderjährig ist, ist zu prüfen, ob zusätzlich ein
Erziehungsberechtigter als verantwortliche Person genannt werden muss. Das ist
eine Rechtsfrage, die ich nicht beantworten kann und zu der ich auch keinen
Text formuliere.

Ergebnis der Prüfung: _______________________________________________


### 2.4 Hosting-Anbieter für die Datenschutzerklärung

- Datei: `datenschutz/index.html`, Zeile 90
- Steht dort: `TODO — Hosting-Anbieter noch einzutragen, sobald feststeht.`
- Ein Hinweis darauf steht zusätzlich in Zeile 31

Steht erst fest, wenn entschieden ist, wo die Seite liegen soll.

Anbieter: ___________________________________________________________


### 2.5 Echte Domain — an vier Stellen

Überall steht zurzeit der Platzhalter `https://www.arthur-gittel.de/`. Das ist
eine erfundene Adresse, keine registrierte Domain. Sie muss an allen vier
Stellen durch die echte ersetzt werden, sonst kann Google die Seiten nicht
zuordnen.

| Datei | Zeile | Inhalt |
|---|---|---|
| `index.html` | 50 | `"url"` in den strukturierten Daten |
| `sitemap.xml` | 9 | Startseite |
| `sitemap.xml` | 13 | `/impressum` |
| `sitemap.xml` | 17 | `/datenschutz` |
| `robots.txt` | 5 | Verweis auf die Sitemap |

Echte Domain: _______________________________________________________

Sobald die Anschrift aus Punkt 2.2 feststeht, gehört sie zusätzlich als
`address` in die strukturierten Daten (`index.html`, ab Zeile 44). Der Hinweis
dazu steht als Kommentar in Zeile 42.


### 2.6 Rechtlicher Preishinweis

- Datei: `index.html`, Zeile 420
- Steht dort als sichtbarer Kasten: „Hier fehlt der rechtlich vorgeschriebene
  Preishinweis (zum Beispiel zur Umsatzsteuer)."

Diesen Text formuliere ich nicht selbst. Er muss von jemandem mit Sachkenntnis
kommen, weil eine falsche Angabe hier abmahnfähig ist.

Einzutragender Text: ________________________________________________


### 2.7 Beispielarbeiten für den Abschnitt „Arbeiten"

- Datei: `index.html`, Zeile 282

Vorgesehen sind zwei bis drei Beispielseiten, je mit Bild, Branche und einem
Satz zur Aufgabe. Zurzeit steht dort nur der ehrliche Hinweis, dass es noch
keine abgeschlossenen Kundenprojekte gibt.

Erfundene Referenzen oder Kundenstimmen kommen dort nicht hinein.

Erstes Beispiel: ____________________________________________________

Zweites Beispiel: ___________________________________________________


## Teil 3 — Was fertig ist

Damit klar ist, was **nicht** mehr offen ist:

- Alle Texte, Abschnitte und das Design
- Der Preisabschnitt mit Silber 399 €, Gold 599 € und Betreuung 20 €/Monat
- Dunkler und heller Modus, richtet sich nach der Geräteeinstellung
- Die drei Illustrationen
- Impressum und Datenschutz als eigene Unterseiten, von überall verlinkt
- Auffindbarkeit bei Google: Titel, Beschreibung, strukturierte Daten,
  `sitemap.xml`, `robots.txt` — bis auf die fehlende Domain
- Geprüft auf 320, 380, 768 und 1280 Pixel Breite, in beiden Farbmodi,
  mit und ohne JavaScript


## Teil 4 — Reihenfolge, die ich vorschlagen würde

1. **Web3Forms-Schlüssel** (2.1) — ohne ihn ist die Seite nutzlos, selbst
   wenn alles andere stimmt
2. **Domain** (2.5) — hängt vieles dran und dauert am längsten
3. **Hosting** (2.4) — folgt aus der Domain-Entscheidung
4. **Anschrift und Erziehungsberechtigter** (2.2, 2.3) — Pflicht vor dem
   geschäftlichen Livegang
5. **Preishinweis** (2.6) — ebenfalls Pflicht
6. **Die zwei Entscheidungen** (1.1, 1.2) — sollten vor dem ersten Kunden
   geklärt sein
7. **Beispielarbeiten** (2.7) — kann nach dem Livegang nachwachsen


---

Trag ein, was du hast, und schick mir die Datei zurück. Ich setze die Angaben
dann an den richtigen Stellen ein. Lücken sind kein Problem — ich ergänze, was
da ist, und lasse den Rest als Platzhalter stehen.
