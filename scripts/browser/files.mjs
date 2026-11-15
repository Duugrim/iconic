// The two file-backed tabs of the browser: icons Iconic made (the output folder) and the user's own SVGs
// (a folder in the module's persistent storage). Folder reading goes through Foundry's FilePicker.

import { CUSTOM_LIBRARY_DIR, ensureDirTree, getFilePickerImpl, getOutputDir, MODULE_ID, trimSlash } from '../lib/storage.mjs';

export const SETTING_RECENT = 'recentIcons';
const MAX_RECENT = 300;
const MAX_DEPTH = 3;
const MAX_FILES = 5000;

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s;
  }
};

/** File name without its folder and extension. */
const baseName = (path) => path.split('/').pop().replace(/\.svg$/i, '');

/**
 * Created icons ordered newest first: the ones in `recents` (newest first), then the rest by name.
 * Foundry's folder listing carries no modification time, so recency is remembered separately.
 * @param {{path: string, name: string, folder: string}[]} files
 * @param {string[]} recents paths, newest first
 */
export function orderCreated(files, recents) {
  const rank = new Map(recents.map((p, i) => [p, i]));
  return files.slice().sort((a, b) => {
    const ra = rank.has(a.path) ? rank.get(a.path) : Infinity;
    const rb = rank.has(b.path) ? rank.get(b.path) : Infinity;
    return ra - rb || a.name.localeCompare(b.name);
  });
}

/** Adds a path to the front of a recents list: no duplicates, capped. */
export function pushRecent(recents, path) {
  return [path, ...recents.filter((p) => p !== path)].slice(0, MAX_RECENT);
}

export function getRecentIcons() {
  try {
    const v = game.settings.get(MODULE_ID, SETTING_RECENT);
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

/** Remembers that an icon was just made, so the "Created" tab can show it first. */
export async function rememberIcon(path) {
  try {
    await game.settings.set(MODULE_ID, SETTING_RECENT, pushRecent(getRecentIcons(), path));
  } catch (e) {
    console.warn('Iconic | could not remember the new icon', e);
  }
}

async function browseDir(dir) {
  const FP = getFilePickerImpl();
  if (!FP?.browse) throw new Error('FilePicker.browse is not available');
  return FP.browse('data', dir);
}

/**
 * Every .svg under a folder, to a few levels deep; the sub-folder it sits in (first level) is its group.
 * A folder that does not exist yields an empty list.
 * @returns {Promise<{path: string, name: string, folder: string}[]>}
 */
export async function listSvgFiles(rootDir, { recursive = false } = {}) {
  const root = trimSlash(rootDir);
  const out = [];

  async function walk(dir, folder, depth) {
    let res;
    try {
      res = await browseDir(dir);
    } catch (_) {
      return; // missing folder or no permission: nothing to list
    }
    for (const f of res?.files ?? []) {
      const path = safeDecode(f);
      if (path.toLowerCase().endsWith('.svg') && out.length < MAX_FILES) out.push({ path, name: baseName(path), folder });
    }
    if (!recursive || depth >= MAX_DEPTH) return;
    for (const d of res?.dirs ?? []) {
      const sub = safeDecode(d);
      await walk(sub, folder || sub.split('/').pop(), depth + 1);
    }
  }

  await walk(root, '', 0);
  return out;
}

/** Icons Iconic made, newest first. */
export async function listCreated() {
  return orderCreated(await listSvgFiles(getOutputDir()), getRecentIcons());
}

/** The user's own SVGs; the folder is created on first use so it can be filled and browsed. */
export async function listCustom() {
  await ensureDirTree(CUSTOM_LIBRARY_DIR);
  const files = await listSvgFiles(CUSTOM_LIBRARY_DIR, { recursive: true });
  return files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}
