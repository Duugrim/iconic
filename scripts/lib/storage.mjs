// Paths and FilePicker helpers for Iconic.
//
// Baked icons are world content, so they go to the world folder by default: they stay with the
// world if the module is removed. User-supplied source icons live in the module's persistent
// storage (survives updates, shared between worlds).

export const MODULE_ID = 'iconic';

export const SETTING_OUTPUT_FOLDER = 'outputFolder';
export const SETTING_PRESET_RECENT = 'recentPresets';
export const SETTING_HEADER_BUTTON = 'showHeaderButton';

/** Where user-supplied source icons live (modules/<id>/storage is kept across updates). */
export const CUSTOM_LIBRARY_DIR = `modules/${MODULE_ID}/storage/custom`;

/** Where saved presets live: persistent storage too, so the library is shared between worlds. */
export const PRESET_LIBRARY_DIR = `modules/${MODULE_ID}/storage/presets`;

/** One file per removed preset: Foundry has no way to delete a file. */
export const PRESET_REMOVED_DIR = `${PRESET_LIBRARY_DIR}/removed`;

export function trimSlash(path) {
  return String(path ?? '').trim().replace(/\/+$/g, '');
}

/** URL of a Data-relative path, honoring a route prefix when the server runs under one. */
export function routeUrl(path) {
  const p = String(path ?? '').trim().replace(/^\/+/, '');
  const getRoute = globalThis.foundry?.utils?.getRoute;
  return typeof getRoute === 'function' ? getRoute(p) : `/${p}`;
}

/** Make a Data-relative path fetchable from the page. */
export function toFetchUrl(path) {
  const p = String(path ?? '').trim();
  if (!p) return '';
  if (p.startsWith('/')) return p;
  if (/^[a-zA-Z]+:/.test(p)) return p;
  return routeUrl(p);
}

export function getFilePickerImpl() {
  return foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

function _defaultOutputDir() {
  const wid = String(game?.world?.id ?? '').trim();
  return `worlds/${wid || '_unknown_'}/${MODULE_ID}/generated`;
}

/** Folder (Data-relative, no trailing slash) the baked SVGs are written to. */
export function getOutputDir() {
  try {
    const s = trimSlash(game.settings.get(MODULE_ID, SETTING_OUTPUT_FOLDER));
    return s || _defaultOutputDir();
  } catch (_) {
    return _defaultOutputDir();
  }
}

/** Create every missing folder of `path` (best effort; existing folders are fine). */
export async function ensureDirTree(path, { source = 'data' } = {}) {
  const parts = trimSlash(path).split('/').filter(Boolean);
  if (!parts.length) return false;

  const FP = getFilePickerImpl();
  if (!FP?.createDirectory) return false;

  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) {
    acc = `${acc}/${parts[i]}`;
    try {
      await FP.createDirectory(source, acc, {});
    } catch (_) {
      // already exists, or no permission: the upload will tell
    }
  }
  return true;
}
