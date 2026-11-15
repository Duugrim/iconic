// The preset library on disk: one JSON file per preset in the module's persistent storage.
//
// It only ever grows. Foundry offers no way to delete a file, so a preset is removed by writing a file named
// after it into `removed/` (the preset's own file stays on disk and can be deleted by hand), and renamed by
// writing a new preset and removing the old one. Nothing is overwritten: a failed write cannot cost a preset.

import {
  ensureDirTree,
  getFilePickerImpl,
  PRESET_LIBRARY_DIR,
  PRESET_REMOVED_DIR,
  toFetchUrl,
} from '../lib/storage.mjs';
import {
  buildPreset,
  isSafePresetId,
  parsePreset,
  PRESET_REMOVED_FORMAT,
  PRESET_VERSION,
  presetFileName,
  visiblePresets,
} from '../lib/preset-schema.mjs';

const READ_BATCH = 16;

const isJson = (path) => path.toLowerCase().endsWith('.json');

/** 'a/b/some-id.json' -> 'some-id' */
const baseName = (path) => decodeURIComponent(path.split('/').pop()).replace(/\.json$/i, '');

/** How the store reaches Foundry's files. */
const foundryFiles = {
  newId: () => foundry.utils.randomID(16),
  browse: (dir) => getFilePickerImpl().browse('data', dir),
  ensureDir: (dir) => ensureDirTree(dir),
  async upload(dir, name, text) {
    const file = new File([text], name, { type: 'application/json' });
    const result = await getFilePickerImpl().upload('data', dir, file, {}, { notify: false });
    return Boolean(result?.path);
  },
  async read(path) {
    const response = await fetch(toFetchUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
};

export class PresetStore {
  constructor(files = foundryFiles) {
    this._files = files;
  }

  /** A preset that cannot be read is skipped: one bad file must not take the library down. */
  async _readPreset(path) {
    try {
      const preset = parsePreset(await this._files.read(path));
      if (!preset) console.warn(`Iconic | ${path} is not a preset this version can read`);
      return preset;
    } catch (e) {
      console.warn(`Iconic | could not read the preset ${path}`, e);
      return null;
    }
  }

  async _browseLibrary() {
    try {
      return await this._files.browse(PRESET_LIBRARY_DIR);
    } catch (_) {
      // Not there yet (a player without the right to browse fails here as well, and again below).
      await this._files.ensureDir(PRESET_LIBRARY_DIR);
      return this._files.browse(PRESET_LIBRARY_DIR);
    }
  }

  async _removedIds() {
    try {
      const { files = [] } = await this._files.browse(PRESET_REMOVED_DIR);
      return files.filter(isJson).map(baseName);
    } catch (_) {
      return []; // the folder appears with the first removal
    }
  }

  /**
   * Everything in the library, newest first.
   * @returns {Promise<{presets: object[], failed: boolean}>} `failed` when the folder cannot be read
   */
  async list() {
    let listing;
    try {
      listing = await this._browseLibrary();
    } catch (e) {
      console.warn('Iconic | the preset folder cannot be read', e);
      return { presets: [], failed: true };
    }

    const paths = (listing?.files ?? []).filter(isJson);
    const presets = [];
    for (let i = 0; i < paths.length; i += READ_BATCH) {
      const read = await Promise.all(paths.slice(i, i + READ_BATCH).map((p) => this._readPreset(p)));
      presets.push(...read.filter(Boolean));
    }
    return { presets: visiblePresets(presets, await this._removedIds()), failed: false };
  }

  /**
   * Writes a new preset.
   * @param {{name: string, values: object, created?: number}} preset
   * @returns {Promise<object>} the preset as it will be read back
   * @throws when the file could not be written
   */
  async save({ name, values, created = Date.now() }) {
    const id = this._files.newId();
    const content = buildPreset({ id, name, created, values });
    await this._files.ensureDir(PRESET_LIBRARY_DIR);
    const saved = await this._files.upload(
      PRESET_LIBRARY_DIR,
      presetFileName(content.name, id),
      JSON.stringify(content, null, 2),
    );
    if (!saved) throw new Error('the preset file was not written');
    return parsePreset(content);
  }

  /** Hides a preset from the library for good. @throws when the file could not be written */
  async remove(id) {
    if (!isSafePresetId(id)) throw new Error(`bad preset id ${id}`);
    await this._files.ensureDir(PRESET_REMOVED_DIR);
    const content = { format: PRESET_REMOVED_FORMAT, version: PRESET_VERSION, id };
    const saved = await this._files.upload(PRESET_REMOVED_DIR, `${id}.json`, JSON.stringify(content));
    if (!saved) throw new Error('the removal was not written');
  }

  /** A new file under the new name first, so that a failure cannot lose the preset. */
  async rename(preset, name) {
    const renamed = await this.save({ name, values: preset.values, created: preset.created });
    await this.remove(preset.id);
    return renamed;
  }
}
