// The bundled library as seen from Foundry: where its files are and a cached loader for its index.

import { loadLibrary } from '../browser/library.mjs';
import { MODULE_ID, routeUrl } from './storage.mjs';

/** Data-relative folder of the bundled library. */
export const LIBRARY_DIR = `modules/${MODULE_ID}/library`;

/** Matches a path inside the bundled library's icon folder: author folder and icon name. */
const LIBRARY_ICON_PATH = /(?:^|\/)modules\/iconic\/library\/icons\/([^/]+)\/([^/]+)\.svg$/;

let _cached = null;

/**
 * The library index, loaded once. Resolves null (and logs) if its files are missing, so callers can
 * carry on without it.
 * @returns {Promise<import('../browser/library.mjs').Library | null>}
 */
export function getLibrary() {
  _cached ??= loadLibrary(routeUrl(LIBRARY_DIR), { dataPath: LIBRARY_DIR }).catch((e) => {
    console.warn('Iconic | the bundled icon library could not be loaded', e);
    return null;
  });
  return _cached;
}

/** Author folder and icon name of a path inside the bundled library, or null for any other path. */
export function parseLibraryIconPath(path) {
  const m = String(path ?? '').trim().match(LIBRARY_ICON_PATH);
  return m ? { folder: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) } : null;
}
