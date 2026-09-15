import { test, expect, Page } from '@playwright/test';

const SEITEN = ['/index.html', '/impressum.html', '/datenschutz.html'];
const SIGNALFARBE = 'rgb(180, 67, 43)'; // #B4432B

/* ==========================================================================
   Teil 1 — Darstellungsfehler: Anordnung über alle acht Prüfbreiten
   ========================================================================== */

const PRUEFBREITEN = [320, 390, 430, 768, 834, 1024, 1180, 1440];

/* T1.1–T1.3: Inhalt mittig, gleicher Abstand links und rechts. */
for (const breite of [768, 834, 1024, 1180, 1440]) {
  test(`T1 — ${breite} px: Inhalt mittig, Abstände links und rechts gleich`, async ({ page }) => {
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto('/index.html');

    const m = await page.evaluate(() => {
      const h = document.querySelector('#leistungen .huelle') as HTMLElement;
      const r = h.getBoundingClientRect();
      const cs = getComputedStyle(h);
      return {
        links: Math.round(r.left + parseFloat(cs.paddingLeft)),
        rechts: Math.round(window.innerWidth - r.right + parseFloat(cs.paddingRight)),
        inhalt: Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      };
    });
    console.log(`  ${breite} px: links ${m.links}, rechts ${m.rechts}, Inhaltsbreite ${m.inhalt}`);
    expect(Math.abs(m.links - m.rechts), 'Abstände ungleich').toBeLessThanOrEqual(1);
    expect(m.inhalt, 'Inhaltsbereich über 1100 px').toBeLessThanOrEqual(1100);
  });
}

/* T1.4: kein waagerechtes Scrollen bei keiner der acht Breiten. */
test('T1 — kein waagerechtes Scrollen bei allen acht Prüfbreiten', async ({ page }) => {
  for (const breite of PRUEFBREITEN) {
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto('/index.html');
    const d = await page.evaluate(() => ({
      s: document.documentElement.scrollWidth,
      c: document.documentElement.clientWidth,
    }));
    console.log(`  ${String(breite).padStart(4)} px: scrollWidth ${d.s}, clientWidth ${d.c}`);
    expect(d.s, `waagerechtes Scrollen bei ${breite} px`).toBeLessThanOrEqual(d.c);
  }
});

/* T1.5: Schriftgröße und Knopfhöhe auf dem Handy. */
test('T1 — 390 px: Fließtext 17–18 px, Knöpfe höchstens 56 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');

  const groesse = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('#leistungen > .huelle > p')!).fontSize)
  );
  console.log(`  Fließtext: ${groesse} px`);
  expect(groesse).toBeGreaterThanOrEqual(17);
  expect(groesse).toBeLessThanOrEqual(18);

  /* Die feste Anrufleiste ist oben auf der Seite ausgeblendet und hat dann
     keine Box — geprüft wird, was sichtbar ist. */
  const knoepfe = page.locator('a.knopf:visible');
  expect(await knoepfe.count()).toBeGreaterThan(0);
  for (let i = 0; i < await knoepfe.count(); i++) {
    const box = (await knoepfe.nth(i).boundingBox())!;
    const text = (await knoepfe.nth(i).textContent())!.trim();
    console.log(`  Knopf „${text}": ${Math.round(box.height)} px hoch`);
    expect(box.height, `„${text}" zu hoch`).toBeLessThanOrEqual(56);
    expect(box.height, `„${text}" zu niedrig`).toBeGreaterThanOrEqual(44);
  }
});

/* T1.6: bei 320 px überlappt nichts und nichts steht über den Rand. */
test('T1 — 320 px: nichts überlappt, nichts steht über den Rand', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/index.html');

  const befund = await page.evaluate(() => {
    /* Ein Element, das über den Rand reicht, aber von einem Vorfahren mit
       overflow:hidden beschnitten wird, ist nicht sichtbar draußen. Die
       Pfoten sind bewusst so gebaut. Beides wird getrennt gemeldet. */
    const beschnitten = (el: Element): boolean => {
      let k = el.parentElement;
      while (k) {
        if (getComputedStyle(k).overflowX !== 'visible') return true;
        k = k.parentElement;
      }
      return false;
    };
    const name = (el: Element) => {
      const k = el.getAttribute('class');
      return el.tagName.toLowerCase() + (k ? '.' + k.split(' ').join('.') : '');
    };

    const sichtbarDraussen: string[] = [];
    const zierBeschnitten: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left >= -0.5 && r.right <= window.innerWidth + 0.5) continue;
      const eintrag = `${name(el)} (${Math.round(r.left)}–${Math.round(r.right)})`;
      (beschnitten(el) ? zierBeschnitten : sichtbarDraussen).push(eintrag);
    }
    return { sichtbarDraussen, zierBeschnitten };
  });

  console.log(`  Sichtbar über den Rand: ${befund.sichtbarDraussen.length ? befund.sichtbarDraussen.join(', ') : 'keine'}`);
  console.log(`  Beschnittene Zier (unsichtbar draußen): ${befund.zierBeschnitten.length} Elemente`);

  expect(befund.sichtbarDraussen).toEqual([]);
  /* Was übersteht, darf ausschließlich Zier sein — nie Inhalt. */
  const inhaltDraussen = befund.zierBeschnitten.filter(
    (e) => !e.startsWith('svg.pfote') && !e.startsWith('use')
  );
  console.log(`  Davon Inhalt statt Zier: ${inhaltDraussen.length ? inhaltDraussen.join(', ') : 'keiner'}`);
  expect(inhaltDraussen).toEqual([]);
});

/* ==========================================================================
   Teil 2 — Waermere Gestaltung
   ========================================================================== */

const SAND = 'rgb(216, 165, 95)';   // #D8A55F

test('T2 — die neuen Farbwerte stehen als Variablen in der Datei', async ({ page }) => {
  await page.goto('/index.html');
  const werte = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const namen = ['--flaeche', '--flaeche-abgesetzt', '--text', '--text-gedaempft',
                   '--gruen', '--gruen-dunkel', '--sand', '--notfall'];
    return namen.map((n) => [n, s.getPropertyValue(n).trim()] as [string, string]);
  });
  for (const [name, wert] of werte) console.log(`  ${name.padEnd(20)} ${wert}`);

  const soll: Record<string, string> = {
    '--flaeche': '#FBF7F0', '--flaeche-abgesetzt': '#F3EDE3',
    '--text': '#2B302C', '--text-gedaempft': '#61665F',
    '--gruen': '#3F7D62', '--gruen-dunkel': '#2C5A46',
    '--sand': '#D8A55F', '--notfall': '#B4432B',
  };
  for (const [name, wert] of werte) {
    expect(wert.toUpperCase(), `${name} falsch`).toBe(soll[name]);
  }
});

test('T2 — der Sandton wird auf keinem Knopf und in keinem Text verwendet', async ({ page }) => {
  for (const seite of SEITEN) {
    await page.goto(seite);
    const treffer = await page.evaluate((sand) => {
      const raus: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const s = getComputedStyle(el);
        if (s.color === sand) raus.push(`Textfarbe: ${el.tagName.toLowerCase()}.${el.className}`);
        if (el.matches('a.knopf, button') && s.backgroundColor === sand) {
          raus.push(`Knopfflaeche: ${el.tagName.toLowerCase()}.${el.className}`);
        }
      }
      return raus;
    }, SAND);
    console.log(`  ${seite}: ${treffer.length ? treffer.join(', ') : 'kein Sandton in Text oder Knöpfen'}`);
    expect(treffer).toEqual([]);
  }
});

test('T2 — „Ihr erster Besuch bei uns" steht zwischen Leistungen und Team', async ({ page }) => {
  await page.goto('/index.html');
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main > section')).map((s) => s.id)
  );
  console.log(`  Reihenfolge: ${ids.join(' → ')}`);
  expect(ids.indexOf('erstbesuch')).toBe(ids.indexOf('leistungen') + 1);
  expect(ids.indexOf('praxis')).toBe(ids.indexOf('erstbesuch') + 1);
  await expect(page.locator('#erstbesuch h2')).toHaveText('Ihr erster Besuch bei uns');
});

test('T2 — kein einziges Bild eingebunden, nur Platzhalterflächen', async ({ page }) => {
  for (const seite of SEITEN) {
    await page.goto(seite);
    const zaehler = await page.evaluate(() => {
      const mitHintergrundbild = Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => {
          const b = getComputedStyle(el).backgroundImage;
          return b !== 'none' && b.includes('url(');
        }).length;
      return {
        img: document.querySelectorAll('img').length,
        picture: document.querySelectorAll('picture, source').length,
        iframe: document.querySelectorAll('iframe').length,
        svgBild: document.querySelectorAll('svg image').length,
        hintergrund: mitHintergrundbild,
      };
    });
    console.log(`  ${seite}: img ${zaehler.img}, picture ${zaehler.picture}, iframe ${zaehler.iframe}, ` +
                `svg-image ${zaehler.svgBild}, Hintergrundbilder ${zaehler.hintergrund}`);
    expect(zaehler.img + zaehler.picture + zaehler.iframe + zaehler.svgBild + zaehler.hintergrund).toBe(0);
  }
  await page.goto('/index.html');
  const platzhalter = await page.locator('.platzhalter-bild').count();
  console.log(`  Platzhalterflächen: ${platzhalter}`);
  expect(platzhalter).toBeGreaterThanOrEqual(4);
});

test('T2 — kein Satz enthält ein Heilversprechen', async ({ page }) => {
  /* Woerter, die eine Wirkung oder einen Erfolg zusagen. Rechtlich heikel. */
  const verboten = [
    'garantier', 'heilen', 'heilung', 'geheilt', 'schmerzfrei', 'beschwerdefrei',
    'wieder gesund', 'erfolgsquote', 'behandlungserfolg', 'sicher wieder',
    'verspricht', 'versprechen', 'zuverlässig gesund', '!',
  ];
  for (const seite of SEITEN) {
    await page.goto(seite);
    const text = (await page.locator('body').innerText()).toLowerCase();
    const gefunden = verboten.filter((w) => text.includes(w));
    console.log(`  ${seite}: ${gefunden.length ? 'GEFUNDEN: ' + gefunden.join(', ') : 'nichts beanstandet'}`);
    expect(gefunden).toEqual([]);
  }
});

/* ==========================================================================
   Teil 3 — Pfotenabdruecke
   ========================================================================== */

test('T3 — Anzahl der Hintergrundpfoten je Abschnitt', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto('/index.html');

  const je = await page.evaluate(() =>
    Array.from(document.querySelectorAll('section')).map((s) => ({
      id: s.id,
      anzahl: s.querySelectorAll('.pfoten .pfote').length,
    }))
  );
  for (const s of je) console.log(`  #${s.id.padEnd(14)} ${s.anzahl} Hintergrundpfoten`);

  const mitPfoten = je.filter((s) => s.anzahl > 0).map((s) => s.id);
  expect(mitPfoten.sort()).toEqual(['erstbesuch', 'leistungen']);
  for (const s of je.filter((x) => x.anzahl > 0)) {
    expect(s.anzahl, `#${s.id} außerhalb 5–7`).toBeGreaterThanOrEqual(5);
    expect(s.anzahl, `#${s.id} außerhalb 5–7`).toBeLessThanOrEqual(7);
  }
});

test('T3 — Deckkraft und Größe der Pfoten liegen im vorgegebenen Bereich', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto('/index.html');

  const werte = await page.evaluate(() =>
    Array.from(document.querySelectorAll<SVGElement>('.pfoten .pfote')).map((el) => {
      /* Die CSS-Breite, nicht getBoundingClientRect: bei gedrehten Elementen
         liefert die Rechteck-Box die umschliessende Flaeche und damit einen
         zu grossen Wert. */
      const s = getComputedStyle(el);
      return { deckkraft: parseFloat(s.opacity), groesse: Math.round(parseFloat(s.width)) };
    })
  );
  const deck = [...new Set(werte.map((w) => w.deckkraft))];
  const groessen = werte.map((w) => w.groesse);
  console.log(`  Deckkraft Hintergrundpfoten: ${deck.join(', ')}`);
  console.log(`  Größen: ${groessen.join(', ')} px`);
  for (const d of deck) {
    expect(d).toBeGreaterThanOrEqual(0.06);
    expect(d).toBeLessThanOrEqual(0.08);
  }
  for (const g of groessen) {
    expect(g).toBeGreaterThanOrEqual(90);
    expect(g).toBeLessThanOrEqual(140);
  }

  const trenner = await page.evaluate(() =>
    Array.from(document.querySelectorAll<SVGElement>('.pfoten-trenner')).map((el) => ({
      deckkraft: parseFloat(getComputedStyle(el).opacity),
      groesse: Math.round(parseFloat(getComputedStyle(el).width)),
    }))
  );
  console.log(`  Trennzeichen: ${trenner.length} Stück, ` +
    `Deckkraft ${[...new Set(trenner.map((t) => t.deckkraft))].join(', ')}, ` +
    `Größe ${trenner.map((t) => t.groesse).join(', ')} px`);
  expect(trenner.length, 'mehr als drei Trennzeichen').toBeLessThanOrEqual(3);
  for (const t of trenner) {
    expect(t.deckkraft).toBeCloseTo(0.35, 2);
    expect(t.groesse).toBeGreaterThanOrEqual(18);
    expect(t.groesse).toBeLessThanOrEqual(22);
  }
});

test('T3 — keine Pfote im Kopfbereich, Notfall, Anrufleiste oder in der Tabelle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');

  const verboten = ['header.kopf', '#notfall', '.anrufleiste', '.zeiten-tabelle',
                    'a.knopf', '.status', 'ul.karten'];
  for (const bereich of verboten) {
    const anzahl = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.querySelectorAll('svg use[href="#pfote"]').length : -1;
    }, bereich);
    console.log(`  ${bereich.padEnd(16)} ${anzahl === -1 ? 'nicht vorhanden' : anzahl + ' Pfoten'}`);
    expect(anzahl, `Pfote in ${bereich}`).toBeLessThanOrEqual(0);
  }
});

test('T3 — alle Pfoten sind aria-hidden und nicht anklickbar', async ({ page }) => {
  await page.goto('/index.html');
  const befund = await page.evaluate(() => {
    const alle = Array.from(document.querySelectorAll('svg')).filter(
      (s) => s.querySelector('use[href="#pfote"]') || s.querySelector('symbol#pfote')
    );
    return alle.map((s) => ({
      klasse: s.getAttribute('class') || '(Symboltraeger)',
      aria: s.getAttribute('aria-hidden'),
      zeiger: getComputedStyle(s).pointerEvents,
    }));
  });
  for (const b of befund) {
    console.log(`  ${String(b.klasse).padEnd(22)} aria-hidden=${b.aria}  pointer-events=${b.zeiger}`);
    expect(b.aria, `${b.klasse} ohne aria-hidden`).toBe('true');
  }
  expect(befund.length).toBeGreaterThan(0);

  /* Der Nutzer darf die Zier nicht versehentlich treffen. */
  const zier = befund.filter((b) => b.klasse !== '(Symboltraeger)');
  for (const b of zier) expect(b.zeiger).toBe('none');
});

test('T3 — höchstens drei Hintergrundpfoten je Abschnitt bei 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');

  const je = await page.evaluate(() =>
    Array.from(document.querySelectorAll('section')).map((s) => ({
      id: s.id,
      sichtbar: Array.from(s.querySelectorAll<SVGElement>('.pfoten .pfote'))
        .filter((p) => getComputedStyle(p).display !== 'none').length,
    })).filter((s) => s.sichtbar > 0)
  );
  for (const s of je) console.log(`  #${s.id}: ${s.sichtbar} sichtbar`);
  for (const s of je) expect(s.sichtbar, `#${s.id} zeigt mehr als drei`).toBeLessThanOrEqual(3);
});

test('T3 — die Pfoten verursachen kein waagerechtes Scrollen', async ({ page }) => {
  for (const breite of PRUEFBREITEN) {
    await page.setViewportSize({ width: breite, height: 900 });
    await page.goto('/index.html');
    const d = await page.evaluate(() => {
      const ueber = Array.from(document.querySelectorAll<SVGElement>('.pfoten .pfote, .pfoten-trenner'))
        .filter((p) => {
          const r = p.getBoundingClientRect();
          return r.right > window.innerWidth + 0.5 || r.left < -0.5;
        }).length;
      return { s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth, ueber };
    });
    console.log(`  ${String(breite).padStart(4)} px: scrollWidth ${d.s} / ${d.c}, ` +
                `${d.ueber} Pfoten über den Rand (durch overflow beschnitten)`);
    expect(d.s).toBeLessThanOrEqual(d.c);
  }
});

/* --- Testfall 1: Alles Wichtige ohne Scrollen bei 380 px ------------------ */
test('1 — Status, Anrufknopf und Notfallhinweis sind bei 380 px ohne Scrollen sichtbar', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 640 });
  await page.goto('/index.html');

  const ziele = {
    'Öffnungsstatus': page.locator('#status'),
    'Anrufknopf': page.locator('header .knopf-haupt'),
    'Notfallverweis': page.locator('.notfall-verweis'),
  };

  for (const [name, el] of Object.entries(ziele)) {
    const box = await el.boundingBox();
    expect(box, `${name} nicht gefunden`).not.toBeNull();
    const unterkante = box!.y + box!.height;
    console.log(`  ${name}: Unterkante bei ${Math.round(unterkante)} px`);
    expect(unterkante, `${name} liegt unterhalb von 640 px`).toBeLessThanOrEqual(640);
  }
});

/* --- Testfall 2: Anrufknopf löst einen Anruf aus -------------------------- */
test('2 — alle Anrufknöpfe sind gültige tel:-Links', async ({ page }) => {
  await page.goto('/index.html');
  const links = page.locator('a[href^="tel:"]');
  await expect(links).not.toHaveCount(0);

  const anzahl = await links.count();
  for (let i = 0; i < anzahl; i++) {
    const href = await links.nth(i).getAttribute('href');
    console.log(`  Anruflink ${i + 1}: ${href}`);
    expect(href).toMatch(/^tel:\+?[0-9]{6,}$/);
  }
});

/* --- Testfall 3: Keine seitliche Verschiebung ----------------------------- */
for (const breite of [320, 380]) {
  test(`3 — kein horizontales Scrollen bei ${breite} px`, async ({ page }) => {
    await page.setViewportSize({ width: breite, height: 800 });
    await page.goto('/index.html');

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`  ${breite} px: scrollWidth ${doc.scrollWidth}, clientWidth ${doc.clientWidth}`);
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);

    // Die Sprechzeiten-Tabelle darf ihren Container nicht sprengen.
    const tabelle = await page.locator('.zeiten-tabelle').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    console.log(`  Tabelle: scrollWidth ${tabelle.scrollWidth}, clientWidth ${tabelle.clientWidth}`);
    expect(tabelle.scrollWidth).toBeLessThanOrEqual(tabelle.clientWidth);
  });
}

/* --- Testfall 4: Notfallbereich mit einem Klick --------------------------- */
test('4 — der Notfallbereich ist von oben mit einem Klick erreichbar', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 640 });
  await page.goto('/index.html');

  await page.locator('.notfall-verweis').click();
  await page.waitForFunction(() => window.location.hash === '#notfall');
  await page.waitForTimeout(600); // sanftes Scrollen abwarten

  const box = await page.locator('#notfall').boundingBox();
  console.log(`  Notfallbereich nach Klick bei y = ${Math.round(box!.y)} px`);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeLessThan(200);
});

/* --- Testfall 5: Signalfarbe nur im Notfallbereich ------------------------ */
test('5 — die Signalfarbe kommt nirgends außerhalb des Notfallbereichs vor', async ({ page }) => {
  for (const seite of SEITEN) {
    await page.goto(seite);
    const treffer = await page.evaluate((farbe) => {
      const raus: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        const s = getComputedStyle(el);
        const werte = [s.color, s.backgroundColor, s.borderTopColor, s.borderBottomColor,
                       s.borderLeftColor, s.borderRightColor, s.outlineColor];
        if (!werte.includes(farbe)) continue;
        if (el.closest('#notfall')) continue;
        raus.push(el.tagName.toLowerCase() + '.' + el.className);
      }
      return raus;
    }, SIGNALFARBE);
    console.log(`  ${seite}: ${treffer.length} Treffer außerhalb #notfall`);
    expect(treffer).toEqual([]);
  }
});

/* --- Testfall 6: Kontraste ------------------------------------------------ */
test('6 — gemessene Kontraste erfüllen WCAG AA', async ({ page }) => {
  await page.goto('/index.html');

  const messungen = await page.evaluate(() => {
    const kanal = (c: number) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const leuchtdichte = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
      return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
    };
    /* Legt alle halbtransparenten Hintergründe der Kette übereinander und gibt
       die tatsächlich sichtbare Farbe zurück. Ohne dieses Zusammenrechnen
       liefert eine Fläche wie rgba(216,165,95,.10) einen falschen Wert. */
    const hintergrund = (el: Element): string => {
      const schichten: Array<[number[], number]> = [];
      let k: Element | null = el;
      while (k) {
        const bg = getComputedStyle(k).backgroundColor;
        const teile = bg.match(/[\d.]+/g);
        if (teile) {
          const a = teile.length > 3 ? parseFloat(teile[3]) : 1;
          if (a > 0) {
            schichten.push([teile.slice(0, 3).map(Number), a]);
            if (a === 1) break;
          }
        }
        k = k.parentElement;
      }
      // Von unten nach oben zusammenrechnen.
      let ergebnis = [255, 255, 255];
      for (const [farbe, a] of schichten.reverse()) {
        ergebnis = ergebnis.map((u, i) => a * farbe[i] + (1 - a) * u);
      }
      return `rgb(${ergebnis.map((c) => Math.round(c)).join(', ')})`;
    };

    const proben: Array<[string, string]> = [
      ['Fließtext', '#leistungen > .huelle > p'],
      ['Fließtext (abgesetzt)', '#erstbesuch > .huelle > p'],
      ['Erstbesuch-Karte', '.erstbesuch-liste p'],
      ['Erstbesuch-Überschrift', '.erstbesuch-liste h3'],
      ['Platzhalterfläche', '.platzhalter-bild'],
      ['Kartentext', '.karte p'],
      ['Gedämpfter Text', '.hinweis'],
      ['Überschrift h1', 'h1'],
      ['Statuszeile', '.status-zeile'],
      ['Statuszusatz', '.status-zusatz'],
      ['Anrufknopf', 'header .knopf-haupt'],
      ['Notfallverweis', '.notfall-verweis'],
      ['Notfalltext', '#notfall p'],
      ['Notfallknopf', '.knopf-notfall'],
      ['Kartenüberschrift', '.karte h3'],
      ['Tabellenzelle', '.zeiten-tabelle td'],
      ['Tabellenbeschriftung', '.zeiten-tabelle caption'],
      ['Demo-Hinweis', '.demo-hinweis p'],
      ['Fußzeilen-Link', '.fuss a'],
      ['Fußzeilen-Text', '.fuss p'],
    ];

    return proben.map(([name, sel]) => {
      const el = document.querySelector(sel);
      if (!el) return { name, sel, fehlt: true, ratio: 0, gross: false, vg: '', hg: '' };
      const st = getComputedStyle(el);
      const vg = st.color;
      const hg = hintergrund(el);
      const l1 = leuchtdichte(vg);
      const l2 = leuchtdichte(hg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(st.fontSize);
      const fett = parseInt(st.fontWeight, 10) >= 700;
      const gross = px >= 24 || (fett && px >= 18.66);
      return { name, sel, fehlt: false, ratio, gross, vg, hg };
    });
  });

  for (const m of messungen) {
    expect(m.fehlt, `${m.name} (${m.sel}) nicht gefunden`).toBe(false);
    const grenze = m.gross ? 3 : 4.5;
    console.log(
      `  ${m.name.padEnd(22)} ${m.vg} auf ${m.hg}  ` +
      `${m.ratio.toFixed(2)}:1  (nötig ${grenze}:1${m.gross ? ', großer Text' : ''})`
    );
    expect(m.ratio, `${m.name} unter ${grenze}:1`).toBeGreaterThanOrEqual(grenze);
  }
});

/* --- Testfall 7 und 8: Demo-Hinweis und noindex auf jeder Seite ----------- */
for (const seite of SEITEN) {
  test(`7/8 — ${seite}: Demo-Hinweis sichtbar und noindex gesetzt`, async ({ page }) => {
    await page.goto(seite);

    const hinweis = page.locator('.demo-hinweis');
    await expect(hinweis).toBeVisible();
    await expect(hinweis).toContainText('Unbeauftragter Gestaltungsentwurf');
    await expect(hinweis).toContainText('nicht die offizielle Seite der Praxis');

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    console.log(`  ${seite}: robots = "${robots}"`);
    expect(robots).toContain('noindex');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  });
}

/* --- Testfall 9: keine fremden Ressourcen -------------------------------- */
test('9 — die Seite lädt ausschließlich eigene Dateien', async ({ page }) => {
  const fremde: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:8765')) fremde.push(r.url());
  });

  for (const seite of SEITEN) {
    await page.goto(seite);
    await page.waitForLoadState('networkidle');
  }

  console.log(`  Fremde Requests: ${fremde.length ? fremde.join(', ') : 'keine'}`);
  expect(fremde).toEqual([]);

  // Keine eingebetteten Bilder oder iframes, die von außen stammen könnten.
  await page.goto('/index.html');
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.locator('iframe').count()).toBe(0);
});

/* --- Testfall 10: Ladezeit ------------------------------------------------ */
test('10 — Ladezeit und Übertragungsvolumen', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'load' });

  const werte = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      domContentLoaded: Math.round(n.domContentLoadedEventEnd),
      load: Math.round(n.loadEventEnd),
      ressourcen: res.length,
      bytes: res.reduce((s, r) => s + (r.decodedBodySize || 0), 0) + (n.decodedBodySize || 0),
    };
  });

  console.log(`  DOMContentLoaded: ${werte.domContentLoaded} ms`);
  console.log(`  Load: ${werte.load} ms`);
  console.log(`  Ressourcen: ${werte.ressourcen + 1} Dateien, ${(werte.bytes / 1024).toFixed(1)} KB`);
  expect(werte.load).toBeLessThan(2000);
});

/* --- Öffnungsstatus: Berechnung an festen Zeitpunkten --------------------- */
test('Öffnungsstatus wird korrekt berechnet', async ({ page }) => {
  await page.goto('/index.html');

  const faelle: Array<[string, string, string]> = [
    ['2026-09-07T10:00:00', 'Montag 10 Uhr',    'Jetzt geöffnet — bis 12 Uhr'],
    ['2026-09-07T13:00:00', 'Montag 13 Uhr',    'Jetzt geschlossen — wieder heute ab 15 Uhr'],
    ['2026-09-07T19:00:00', 'Montag 19 Uhr',    'Jetzt geschlossen — wieder morgen ab 9 Uhr'],
    ['2026-09-09T13:00:00', 'Mittwoch 13 Uhr',  'Jetzt geschlossen — wieder morgen ab 9 Uhr'],
    ['2026-09-13T11:00:00', 'Sonntag 11 Uhr',   'Jetzt geschlossen — wieder morgen ab 9 Uhr'],
    ['2026-09-12T11:00:00', 'Samstag 11 Uhr',   'Jetzt geöffnet — bis 12 Uhr'],
  ];

  for (const [iso, name, erwartet] of faelle) {
    const text = await page.evaluate(
      (i) => (window as any).oeffnungsstatus.ermittleStatus(new Date(i)).text,
      iso
    );
    console.log(`  ${name.padEnd(18)} → ${text}`);
    expect(text, name).toBe(erwartet);
  }
});
