// The icon browser window (Foundry v13+, ApplicationV2). It only hosts a BrowserView and reports the
// chosen path; the editor decides what to do with it.

import { fetchSvgText } from '../lib/svg-bake.mjs';
import { getLibrary } from '../lib/library-source.mjs';
import { CUSTOM_LIBRARY_DIR, ensureDirTree, getFilePickerImpl, toFetchUrl } from '../lib/storage.mjs';
import { BrowserView } from './browser-view.mjs';
import { listCreated, listCustom } from './files.mjs';

const WINDOW_ID = 'iconic-browser';

function t(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch (_) {
    return key;
  }
}

export class IconBrowser extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: WINDOW_ID,
    classes: ['iconic', 'iconic-browser-window'],
    tag: 'div',
    window: { title: 'ICONIC.Browser.Title', icon: 'fa-solid fa-icons', resizable: true },
    position: { width: 940, height: 640 },
  };

  /**
   * @param {object} [options]
   * @param {string} [options.tab] 'library' | 'created' | 'custom'
   * @param {string} [options.startDir] where the general file picker opens
   */
  constructor({ tab = 'library', startDir = '' } = {}) {
    super();
    this._tab = tab;
    this._startDir = String(startDir ?? '').trim();
    this._resolve = null;
    this._view = null;
    this._library = null;
  }

  /**
   * Opens the browser and resolves with the chosen file, or null when it was closed without choosing.
   * @returns {Promise<{path: string, source: 'library'|'created'|'custom'|'file'} | null>}
   */
  static async wait(options = {}) {
    foundry.applications.instances.get(WINDOW_ID)?.close();
    const app = new IconBrowser(options);
    app._library = await getLibrary();
    return new Promise((resolve) => {
      app._resolve = resolve;
      app.render(true);
    });
  }

  async _renderHTML() {
    const root = document.createElement('div');
    root.className = 'iconic-browser-host';
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._view?.destroy();
    this._view = new BrowserView(result, this._services(), { tab: this._tab });
  }

  _services() {
    return {
      library: this._library,
      t,
      listCreated,
      listCustom,
      fileUrl: toFetchUrl,
      fetchText: fetchSvgText,
      customFolder: CUSTOM_LIBRARY_DIR,
      chooseFile: () => this._openFilePicker(this._startDir),
      openCustomFolder: () => this._openCustomFolder(),
      onPick: (result) => this._finish(result),
      onCancel: () => this.close(),
    };
  }

  _finish(result) {
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve(result);
    }
    this.close();
  }

  _openFilePicker(current) {
    const FP = getFilePickerImpl();
    if (typeof FP !== 'function') {
      ui.notifications?.warn?.(t('ICONIC.Editor.Errors.NoFilePicker'));
      return;
    }
    new FP({
      type: 'image',
      current,
      callback: (path) => {
        const picked = String(path ?? '').trim();
        if (picked) this._finish({ path: picked, source: 'file' });
      },
    }).render(true);
  }

  /** Opens a file browser at the custom folder so the user can upload SVGs into it (or pick one). */
  async _openCustomFolder() {
    await ensureDirTree(CUSTOM_LIBRARY_DIR);
    Hooks.once('closeFilePicker', () => {
      this._view?.invalidateFiles();
      if (this._view?.tab === 'custom') this._view.setTab('custom');
    });
    this._openFilePicker(CUSTOM_LIBRARY_DIR);
  }

  async close(options = {}) {
    await super.close(options);
    this._view?.destroy();
    this._view = null;
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve(null);
    }
  }
}
