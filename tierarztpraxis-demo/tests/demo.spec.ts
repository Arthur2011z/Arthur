import { test, expect, Page } from '@playwright/test';

const SEITEN = ['/index.html', '/impressum.html', '/datenschutz.html'];
const SIGNALFARBE = 'rgb(180, 67, 43)'; // #B4432B

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
    /* Sucht den ersten nicht-transparenten Hintergrund oberhalb des Elements. */
    const hintergrund = (el: Element): string => {
      let k: Element | null = el;
      while (k) {
        const bg = getComputedStyle(k).backgroundColor;
        if (bg && !bg.startsWith('rgba(0, 0, 0, 0)')) return bg;
        k = k.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };

    const proben: Array<[string, string]> = [
      ['Fließtext', '#leistungen > .huelle > p'],
      ['Fließtext (abgesetzt)', '#praxis > .huelle > p'],
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
