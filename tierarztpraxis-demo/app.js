/* Öffnungsstatus für die Gestaltungsdemo.
 *
 * Der Status wird aus den unten hinterlegten Zeiten berechnet, nicht fest
 * geschrieben. Grundlage ist die Uhrzeit des Geräts: wer die Seite in einer
 * anderen Zeitzone öffnet, sieht den Status seiner eigenen Zeit. Für den
 * Echteinsatz wäre das auf die Praxiszeitzone festzulegen.
 *
 * Zeiten in Minuten seit Mitternacht. Index 0 = Sonntag.
 */
(function () {
  'use strict';

  var TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  var ZEITEN = [
    [],                                  // Sonntag: geschlossen
    [[540, 720], [900, 1080]],           // Montag     9–12, 15–18
    [[540, 720], [900, 1080]],           // Dienstag
    [[540, 720]],                        // Mittwoch   9–12
    [[540, 720], [900, 1080]],           // Donnerstag
    [[540, 720], [900, 1080]],           // Freitag
    [[600, 720]]                         // Samstag   10–12
  ];

  /* 570 -> "9.30 Uhr", 1080 -> "18 Uhr" */
  function alsUhrzeit(minuten) {
    var std = Math.floor(minuten / 60);
    var min = minuten % 60;
    return min === 0 ? std + ' Uhr' : std + '.' + String(min).padStart(2, '0') + ' Uhr';
  }

  /* Sucht ab dem angegebenen Tag die nächste Öffnung. */
  function naechsteOeffnung(tag, minuten) {
    for (var i = 0; i < 8; i++) {
      var t = (tag + i) % 7;
      var bloecke = ZEITEN[t];
      for (var b = 0; b < bloecke.length; b++) {
        if (i > 0 || bloecke[b][0] > minuten) {
          return { versatz: i, tag: t, beginn: bloecke[b][0] };
        }
      }
    }
    return null;
  }

  function tagBezeichnung(versatz, tag) {
    if (versatz === 0) return 'heute';
    if (versatz === 1) return 'morgen';
    return 'am ' + TAGE[tag];
  }

  function ermittleStatus(jetzt) {
    var tag = jetzt.getDay();
    var minuten = jetzt.getHours() * 60 + jetzt.getMinutes();

    var bloecke = ZEITEN[tag];
    for (var b = 0; b < bloecke.length; b++) {
      if (minuten >= bloecke[b][0] && minuten < bloecke[b][1]) {
        var ende = bloecke[b][1];
        var spaeter = naechsteOeffnung(tag, ende);
        var zusatz = 'Danach ' + (spaeter && spaeter.versatz === 0
          ? 'wieder ab ' + alsUhrzeit(spaeter.beginn) + '.'
          : 'geschlossen.');
        return {
          offen: true,
          text: 'Jetzt geöffnet — bis ' + alsUhrzeit(ende),
          zusatz: zusatz
        };
      }
    }

    var naechste = naechsteOeffnung(tag, minuten);
    if (!naechste) {
      return { offen: false, text: 'Zurzeit geschlossen', zusatz: 'Die Sprechzeiten finden Sie unten.' };
    }
    return {
      offen: false,
      text: 'Jetzt geschlossen — wieder ' +
            tagBezeichnung(naechste.versatz, naechste.tag) + ' ab ' + alsUhrzeit(naechste.beginn),
      zusatz: 'Im Notfall erreichen Sie uns auch außerhalb der Sprechzeiten.'
    };
  }

  function anwenden(jetzt) {
    var status = ermittleStatus(jetzt);
    var block = document.getElementById('status');
    if (!block) return;

    block.dataset.offen = status.offen ? 'ja' : 'nein';
    document.getElementById('status-text').textContent = status.text;
    document.getElementById('status-zusatz').textContent = status.zusatz;

    var heute = document.querySelector('.zeiten-tabelle tr[data-tag="' + jetzt.getDay() + '"]');
    if (heute) heute.setAttribute('aria-current', 'date');
  }

  /* Die feste Anrufleiste erscheint erst, wenn der große Anrufknopf oben aus
   * dem Bild gescrollt ist. Ohne JavaScript bleibt sie dauerhaft sichtbar. */
  function anrufleisteSteuern() {
    var leiste = document.querySelector('.anrufleiste');
    if (!leiste || !('IntersectionObserver' in window)) return;

    /* Verstecken, solange der grosse Anrufknopf im Bild ist (sonst doppelt)
     * und solange der Notfallbereich im Bild ist — dort darf die allgemeine
     * Nummer den Notfallknopf nicht verdecken. */
    var beobachtet = ['#anruf-haupt', '#notfall']
      .map(function (s) { return document.querySelector(s); })
      .filter(Boolean);
    if (!beobachtet.length) return;

    var sichtbar = new Set();
    var beobachter = new IntersectionObserver(function (eintraege) {
      eintraege.forEach(function (e) {
        if (e.isIntersecting) sichtbar.add(e.target);
        else sichtbar.delete(e.target);
      });
      leiste.hidden = sichtbar.size > 0;
    });
    beobachtet.forEach(function (el) { beobachter.observe(el); });
  }

  /* Für den automatisierten Test aufrufbar, sonst mit der echten Uhrzeit. */
  window.oeffnungsstatus = { ermittleStatus: ermittleStatus, anwenden: anwenden };
  anwenden(new Date());
  anrufleisteSteuern();
})();
