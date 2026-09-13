import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));

/* Eigene Konfiguration für die Tierarztpraxis-Demo, damit die Einstellungen
 * des Volleyballspiels (Pixel-7-Gerät) unberührt bleiben. Die Seite wird über
 * einen kurzlebigen lokalen Server ausgeliefert, nicht über file://, damit
 * Schriftladen und Ladezeitmessung dem echten Betrieb entsprechen. */
export default defineConfig({
  testDir: './tests',
  reporter: [['list']],
  webServer: {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8765/index.html',
    /* DEMO_DIR=dist prüft das Verzeichnis, das Netlify tatsächlich ausliefert. */
    cwd: process.env.DEMO_DIR ? join(hier, process.env.DEMO_DIR) : hier,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://127.0.0.1:8765',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
});
