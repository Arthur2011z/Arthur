import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** file:// URL of the production build's single bundled HTML file. */
export const distIndex = pathToFileURL(
  path.resolve(dirname, '..', 'dist', 'index.html'),
).toString();
