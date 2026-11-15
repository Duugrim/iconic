// The editor's side of presets: fills the strip under the preview, applies styles, opens the windows.
// The editor is reached only through its style API (getStyleOpts, applyStyleOpts, factionInfo,
// getSourceSvgText); it is not imported here, because it imports this file.

import { MODULE_ID, SETTING_PRESET_RECENT } from '../lib/storage.mjs';
import {
  RECENT_LIMIT,
  entryResult,
  isEntryActive,
  makeEntry,
  planApply,
  pushEntry,
  rememberIconStyle,
  sanitizeRecent,
} from '../lib/preset-recent.mjs';
import { styleSig } from '../lib/preset-schema.mjs';
import { entryTooltip } from '../lib/preset-text.mjs';
import { PresetLibraryApp } from './preset-library-app.mjs';
import { PresetSaveApp } from './preset-save-app.mjs';
import { PresetStore } from './preset-store.mjs';
import { PresetThumbs } from './preset-thumbs.mjs';
import { el, icon, setHtmlTooltip, t } from './ui.mjs';

/** Dragging a slider changes the style many times a second; the strip follows when it pauses. */
const REFRESH_DELAY_MS = 120;

/** Entries that are only remembered here and not in the library, with the mark on their tile. */
const CACHED_MARKS = { snapshot: 'fa-clock-rotate-left', icon: 'fa-image' };

/** 'modules/x/bell%20shield.svg' -> 'bell shield' */
function _iconName(path) {
  const file = String(path ?? '').split('/').pop().replace(/\.[^.]*$/, '');
  try {
    return decodeURIComponent(file);
  } catch (_) {
    return file;
  }
}

function _formatTime(at) {
  try {
    return new Date(at).toLocaleTimeString(game.i18n.lang, { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

export class PresetController {
  /** @param {import('../editor/editor-app.mjs').IconicEditor} editor */
  constructor(editor) {
    this.editor = editor;
    this.store = new PresetStore();
    this.thumbs = new PresetThumbs();

    this._slot = null;
    this._recent = null;
    this._lastSig = null;
    this._timer = null;
    this._library = null;
    this._saveApp = null;
    this._onClick = this._onClick.bind(this);
  }

  /** Called on every render of the editor with the (new, empty) slot element. */
  mount(slot) {
    if (!slot) return;
    this._slot = slot;
    slot.addEventListener('click', this._onClick);
    this._drawStrip();
    this._loadSource();
  }

  /** Called whenever the style may have changed. */
  onStyleChanged() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._refresh(), REFRESH_DELAY_MS);
  }

  /** Called when the icon is saved: its style stays in the strip for the next one. */
  onIconSaved(srcPath) {
    const { editor } = this;
    this._setRecent(rememberIconStyle({
      recent: this.recent,
      style: editor.getStyleOpts(),
      name: _iconName(srcPath),
      factionColor: editor.factionInfo.color,
      at: Date.now(),
    }));
  }

  /** Called when the editor closes. */
  close() {
    clearTimeout(this._timer);
    this._slot = null;
    this._library?.close();
    this._saveApp?.close();
  }

  get recent() {
    if (!this._recent) {
      let stored = [];
      try {
        stored = game.settings.get(MODULE_ID, SETTING_PRESET_RECENT);
      } catch (_) {
        // not registered: starts empty
      }
      this._recent = sanitizeRecent(stored);
    }
    return this._recent;
  }

  _setRecent(list) {
    this._recent = list;
    Promise.resolve()
      .then(() => game.settings.set(MODULE_ID, SETTING_PRESET_RECENT, list))
      .catch((e) => console.warn('Iconic | could not remember the recent styles', e));
  }

  /** Data URI of the current icon with a style applied to the current style. */
  previewUri({ values, skip = [] }) {
    const { editor } = this;
    return this.thumbs.uriFor(entryResult({ values, skip }, editor.getStyleOpts(), editor.factionInfo.color));
  }

  /** Uses an entry of the strip or the library: one click, and the previous settings stay within reach. */
  applyEntry(entry) {
    const { editor } = this;
    const plan = planApply({
      style: editor.getStyleOpts(),
      entry,
      recent: this.recent,
      lastSig: this._lastSig,
      factionColor: editor.factionInfo.color,
      at: Date.now(),
    });

    this._setRecent(plan.recent);
    if (plan.changed) editor.applyStyleOpts(plan.merged); // draws the window, and the strip with it
    else this._drawStrip();
    this._lastSig = styleSig(editor.getStyleOpts());
  }

  /** The source icon may have changed: pictures are of the current icon. */
  async _loadSource() {
    const text = await this.editor.getSourceSvgText();
    if (this.thumbs.setSource(text)) this._refresh();
  }

  _refresh() {
    this._refreshTiles();
    this._library?.refreshThumbs();
  }

  _drawStrip() {
    const slot = this._slot;
    if (!slot) return;

    const { recent } = this;
    const tiles = el('div', { class: 'iconic-presets__tiles' });
    if (recent.length) {
      tiles.append(...recent.map((entry, index) => this._tile(entry, index)));
      for (let i = recent.length; i < RECENT_LIMIT; i++) tiles.append(el('span', { class: 'iconic-presets__slot' }));
    } else {
      tiles.append(el('p', { class: 'iconic-presets__empty', text: t('ICONIC.Presets.Strip.Empty') }));
    }

    slot.replaceChildren(el('div', { class: 'iconic-presets' }, [
      el('div', { class: 'iconic-presets__actions' }, [
        this._action('save', 'fa-floppy-disk', 'Save'),
        this._action('library', 'fa-swatchbook', 'Library'),
      ]),
      tiles,
    ]));
    this._refreshTiles();
  }

  _action(action, iconName, key) {
    return el('button', {
      type: 'button',
      class: 'iconic-presets__action',
      data: { presetAction: action, tooltip: t(`ICONIC.Presets.Strip.${key}Hint`) },
    }, [icon(iconName), el('span', { text: t(`ICONIC.Presets.Strip.${key}`) })]);
  }

  _tileLabel(entry) {
    if (entry.kind === 'snapshot') return t('ICONIC.Presets.Strip.Snapshot');
    if (entry.kind === 'icon') return t('ICONIC.Presets.Strip.IconStyle', { name: entry.name });
    return entry.name;
  }

  _tile(entry, index) {
    const mark = CACHED_MARKS[entry.kind];
    const partial = entry.skip.length > 0;
    const tile = el('button', {
      type: 'button',
      class: `iconic-presets__tile${mark ? ' is-snapshot' : ''}${partial ? ' is-partial' : ''}`,
      'aria-label': this._tileLabel(entry),
      data: { presetAction: 'apply', index },
    }, [el('img', { alt: '' })]);

    if (mark) tile.append(el('span', { class: 'iconic-presets__mark is-snapshot' }, [icon(mark)]));
    if (partial) tile.append(el('span', { class: 'iconic-presets__mark is-partial' }, [icon('fa-puzzle-piece')]));

    setHtmlTooltip(tile, entryTooltip(entry, {
      t,
      factionColor: this.editor.factionInfo.color,
      formatTime: _formatTime,
    }));
    return tile;
  }

  /** The pictures show the result on the current style; tiles that style already matches are marked. */
  _refreshTiles() {
    if (!this._slot) return;
    const { editor } = this;
    const style = editor.getStyleOpts();
    const { color } = editor.factionInfo;

    for (const tile of this._slot.querySelectorAll('.iconic-presets__tile')) {
      const entry = this.recent[Number(tile.dataset.index)];
      if (!entry) continue;
      const img = tile.querySelector('img');
      const uri = this.previewUri(entry);
      if (img.getAttribute('src') !== uri) img.src = uri;
      tile.classList.toggle('is-active', isEntryActive(entry, style, color));
    }
  }

  _onClick(ev) {
    const button = ev.target?.closest?.('[data-preset-action]');
    if (!button) return;
    switch (button.dataset.presetAction) {
      case 'apply': {
        const entry = this.recent[Number(button.dataset.index)];
        if (entry) this.applyEntry(entry);
        break;
      }
      case 'save':
        this.openSave();
        break;
      case 'library':
        this.openLibrary();
        break;
      default:
    }
  }

  openSave() {
    if (this._saveApp?.rendered) {
      this._saveApp.bringToFront();
      return;
    }
    const { color, supported } = this.editor.factionInfo;
    this._saveApp = new PresetSaveApp({
      getStyle: () => this.editor.getStyleOpts(),
      faction: { color, supported },
      onSave: (preset) => this._save(preset),
    });
    this._saveApp.render(true);
  }

  openLibrary() {
    if (this._library?.rendered) {
      this._library.bringToFront();
      return;
    }
    this._library = new PresetLibraryApp({ controller: this });
    this._library.render(true);
  }

  /** @throws when the file could not be written */
  async _save({ name, values }) {
    const preset = await this.store.save({ name, values });
    const entry = makeEntry({ presetId: preset.id, name: preset.name, values: preset.values, at: Date.now() });
    if (entry) this._setRecent(pushEntry(this.recent, entry));
    this._drawStrip();
    if (this._library?.rendered) this._library.reload();
    ui.notifications?.info?.(t('ICONIC.Presets.Save.Saved', { name: preset.name }));
  }
}
