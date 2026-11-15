// The window that saves the current style as a preset: a name, and what goes into it.

import { collectValues, cleanPresetName, PRESET_FIELD_IDS, PRESET_FIELDS } from '../lib/preset-schema.mjs';
import { FieldTree } from './preset-tree.mjs';
import { el, icon, t } from './ui.mjs';

export class PresetSaveApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: 'iconic-preset-save',
    classes: ['iconic', 'iconic-presets-window'],
    tag: 'div',
    window: { title: 'ICONIC.Presets.Save.Title', icon: 'fa-solid fa-floppy-disk', resizable: false },
    position: { width: 700, height: 'auto' },
  };

  /**
   * @param {object} options
   * @param {() => object} options.getStyle the current style: the editor stays usable under this window
   * @param {{color: string|null, supported: boolean}} options.faction
   * @param {(preset: {name: string, values: object}) => Promise<void>} options.onSave rejects if it failed
   */
  constructor({ getStyle, faction, onSave }) {
    super();
    this._getStyle = getStyle;
    this._faction = faction;
    this._onSave = onSave;
    this._busy = false;
  }

  /** Colors that are the faction color right now most likely mean it. */
  _initiallyLinked(values) {
    const { color, supported } = this._faction;
    if (!supported || !color) return [];
    return PRESET_FIELDS.filter((f) => f.kind === 'color' && values[f.id] === color).map((f) => f.id);
  }

  async _renderHTML() {
    const values = collectValues(this._getStyle(), PRESET_FIELD_IDS);
    this._tree = new FieldTree({
      values,
      faction: { supported: this._faction.supported, linked: this._initiallyLinked(values) },
      onChange: () => this._syncButton(),
    });

    this._nameInput = el('input', {
      type: 'text',
      maxlength: 80,
      placeholder: t('ICONIC.Presets.Save.NamePlaceholder'),
      'aria-label': t('ICONIC.Presets.Save.Name'),
    });
    this._nameInput.addEventListener('input', () => this._syncButton());
    this._nameInput.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      this._submit();
    });

    this._saveButton = el('button', { type: 'button', class: 'primary' }, [
      icon('fa-floppy-disk'),
      t('ICONIC.Presets.Save.Confirm'),
    ]);
    this._saveButton.addEventListener('click', () => this._submit());

    const cancel = el('button', { type: 'button' }, [icon('fa-times'), t('ICONIC.Actions.Cancel')]);
    cancel.addEventListener('click', () => this.close());

    return el('div', { class: 'iconic-presets-save' }, [
      el('label', { class: 'iconic-presets-save__name' }, [
        el('span', { text: t('ICONIC.Presets.Save.Name') }),
        this._nameInput,
      ]),
      el('p', { class: 'iconic-presets-save__hint', text: t('ICONIC.Presets.Save.Hint') }),
      this._tree.element,
      el('footer', { class: 'iconic-presets-save__foot' }, [this._saveButton, cancel]),
    ]);
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._syncButton();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._nameInput.focus();
  }

  get _ready() {
    return !this._busy && Boolean(cleanPresetName(this._nameInput.value)) && this._tree.selected.length > 0;
  }

  _syncButton() {
    this._saveButton.disabled = !this._ready;
  }

  async _submit() {
    if (!this._ready) return;
    this._busy = true;
    this._syncButton();
    try {
      await this._onSave({
        name: cleanPresetName(this._nameInput.value),
        values: collectValues(this._getStyle(), this._tree.selected, this._tree.linked),
      });
      await this.close();
    } catch (e) {
      console.error('Iconic | saving the preset failed', e);
      ui.notifications?.error?.(t('ICONIC.Presets.Errors.SaveFailed'));
      this._busy = false;
      this._syncButton();
    }
  }
}
