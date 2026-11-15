// The preset library window: every saved style, each loaded whole or in part. It stays open while styles
// are tried out, and closes with the editor.

import { escapeHtml } from '../lib/preset-text.mjs';
import { makeEntry } from '../lib/preset-recent.mjs';
import { cleanPresetName } from '../lib/preset-schema.mjs';
import { FieldTree } from './preset-tree.mjs';
import { el, icon, t } from './ui.mjs';

export class PresetLibraryApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: 'iconic-preset-library',
    classes: ['iconic', 'iconic-presets-window'],
    tag: 'div',
    window: { title: 'ICONIC.Presets.Library.Title', icon: 'fa-solid fa-swatchbook', resizable: true },
    position: { width: 1060, height: 640 },
  };

  /** @param {{controller: import('./preset-controller.mjs').PresetController}} options */
  constructor({ controller }) {
    super();
    this._controller = controller;
    this._presets = [];
    this._failed = false;
    this._loading = true;
    this._query = '';
    this._selected = null;
    this._tree = null;
    this._observer = null;
    this._onClick = this._onClick.bind(this);
  }

  async _renderHTML() {
    this._search = el('input', {
      type: 'search',
      class: 'iconic-presets-lib__search',
      placeholder: t('ICONIC.Presets.Library.Search'),
      'aria-label': t('ICONIC.Presets.Library.Search'),
    });
    this._search.value = this._query;
    this._search.addEventListener('input', () => {
      this._query = this._search.value;
      this._drawCards();
    });

    this._count = el('span', { class: 'iconic-presets-lib__count' });
    this._cards = el('div', { class: 'iconic-presets-lib__cards' });
    this._detail = el('aside', { class: 'iconic-presets-lib__detail' });

    const root = el('div', { class: 'iconic-presets-lib' }, [
      el('header', { class: 'iconic-presets-lib__top' }, [this._search, this._count]),
      el('div', { class: 'iconic-presets-lib__body' }, [this._cards, this._detail]),
    ]);
    root.addEventListener('click', this._onClick);
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
    this._watchThumbs();
    this._drawCards();
    this._drawDetail();
    if (this._loading) this.reload();
  }

  /** Reads the library again and draws it, keeping the selection if that preset is still there. */
  async reload() {
    const { presets, failed } = await this._controller.store.list();
    this._presets = presets;
    this._failed = failed;
    this._loading = false;
    if (!this.rendered) return;
    if (!presets.some((p) => p.id === this._selected?.id)) this._selected = null;
    this._drawCards();
    this._drawDetail();
  }

  /** A picture is only made once its card comes into view. */
  _watchThumbs() {
    this._observer?.disconnect();
    this._observer = new IntersectionObserver((seen) => {
      for (const { target, isIntersecting } of seen) {
        if (isIntersecting) this._drawThumb(target);
      }
    }, { root: this._cards });
  }

  _drawThumb(img) {
    const preset = this._presets.find((p) => p.id === img.dataset.id);
    if (preset) img.src = this._controller.previewUri({ values: preset.values });
  }

  /** The current style or icon changed, and with it what every preset would give. */
  refreshThumbs() {
    if (!this.rendered || !this._observer) return;
    this._observer.disconnect();
    for (const img of this._cards.querySelectorAll('img')) this._observer.observe(img);
    this._drawDetailThumb();
  }

  get _shown() {
    const query = this._query.trim().toLowerCase();
    return query ? this._presets.filter((p) => p.name.toLowerCase().includes(query)) : this._presets;
  }

  _note(text) {
    return el('p', { class: 'iconic-presets-lib__note', text });
  }

  /** What the list says instead of showing cards, if it has none to show. */
  _emptyNote(shown) {
    if (this._loading) return 'Loading';
    if (this._failed) return 'Unavailable';
    if (!this._presets.length) return 'Empty';
    return shown.length ? null : 'NoResults';
  }

  _drawCards() {
    const shown = this._shown;
    this._count.textContent = t('ICONIC.Presets.Library.Count', { shown: shown.length, total: this._presets.length });
    this._observer?.disconnect();

    const note = this._emptyNote(shown);
    if (note) {
      this._cards.replaceChildren(this._note(t(`ICONIC.Presets.Library.${note}`)));
      return;
    }

    this._cards.replaceChildren(...shown.map((preset) => {
      const img = el('img', { alt: '', data: { id: preset.id } });
      const card = el('button', {
        type: 'button',
        class: `iconic-presets-lib__card${preset.id === this._selected?.id ? ' is-selected' : ''}`,
        data: { presetAction: 'select', id: preset.id },
        title: preset.name, // a long name is cut on the card; a plain title cannot carry HTML
        'aria-pressed': preset.id === this._selected?.id ? 'true' : 'false',
      }, [img, el('span', { text: preset.name })]);
      this._observer?.observe(img);
      return card;
    }));
  }

  _drawDetail() {
    const preset = this._selected;
    this._tree = null;
    if (!preset) {
      this._detail.replaceChildren(this._note(t('ICONIC.Presets.Library.Select')));
      return;
    }

    this._tree = new FieldTree({
      values: preset.values,
      onChange: () => {
        this._loadButton.disabled = !this._tree.selected.length;
        this._drawDetailThumb();
      },
    });
    this._detailThumb = el('img', { alt: '' });
    this._loadButton = el('button', {
      type: 'button',
      class: 'primary',
      data: { presetAction: 'load' },
    }, [icon('fa-check'), t('ICONIC.Presets.Library.Load')]);

    const rename = t('ICONIC.Presets.Library.Rename');
    const remove = t('ICONIC.Presets.Library.Delete');
    this._detail.replaceChildren(
      el('div', { class: 'iconic-presets-lib__head' }, [
        el('div', { class: 'iconic-presets-lib__preview' }, [this._detailThumb]),
        el('div', { class: 'iconic-presets-lib__title' }, [
          el('h3', { text: preset.name }),
          el('p', { text: t('ICONIC.Presets.Library.LoadHint') }),
        ]),
      ]),
      this._tree.element,
      el('footer', { class: 'iconic-presets-lib__foot' }, [
        this._loadButton,
        el('button', {
          type: 'button',
          data: { presetAction: 'rename', tooltip: rename },
          'aria-label': rename,
        }, [icon('fa-pen')]),
        el('button', {
          type: 'button',
          data: { presetAction: 'delete', tooltip: remove },
          'aria-label': remove,
        }, [icon('fa-trash')]),
      ]),
    );
    this._drawDetailThumb();
  }

  /** The big picture follows the checkboxes: it shows what loading would do. */
  _drawDetailThumb() {
    if (!this._selected || !this._tree) return;
    const entry = { values: this._selected.values, skip: this._tree.unselected };
    this._detailThumb.src = this._controller.previewUri(entry);
  }

  _onClick(ev) {
    const button = ev.target?.closest?.('[data-preset-action]');
    if (!button) return;
    switch (button.dataset.presetAction) {
      case 'select':
        this._selected = this._presets.find((p) => p.id === button.dataset.id) ?? null;
        this._drawCards();
        this._drawDetail();
        break;
      case 'load':
        this._load();
        break;
      case 'rename':
        this._rename();
        break;
      case 'delete':
        this._delete();
        break;
      default:
    }
  }

  _load() {
    const preset = this._selected;
    const entry = makeEntry({
      presetId: preset.id,
      name: preset.name,
      values: preset.values,
      skip: this._tree.unselected,
    });
    if (entry) this._controller.applyEntry(entry);
  }

  async _rename() {
    const preset = this._selected;
    const field = 'name';
    const name = await foundry.applications.api.DialogV2.prompt({
      window: { title: 'ICONIC.Presets.Library.Rename' },
      content: `<input type="text" name="${field}" maxlength="80" value="${escapeHtml(preset.name)}" aria-label="${escapeHtml(t('ICONIC.Presets.Save.Name'))}" autofocus>`,
      ok: { label: 'ICONIC.Presets.Library.Rename', callback: (_ev, button) => button.form.elements[field].value },
      rejectClose: false,
    });
    const next = cleanPresetName(name);
    if (!next || next === preset.name) return;

    try {
      const renamed = await this._controller.store.rename(preset, next);
      this._selected = renamed;
      await this.reload();
    } catch (e) {
      console.error('Iconic | renaming the preset failed', e);
      ui.notifications?.error?.(t('ICONIC.Presets.Errors.RenameFailed'));
    }
  }

  async _delete() {
    const preset = this._selected;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: 'ICONIC.Presets.Library.DeleteTitle' },
      content: `<p>${escapeHtml(t('ICONIC.Presets.Library.DeleteConfirm', { name: preset.name }))}</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;

    try {
      await this._controller.store.remove(preset.id);
      this._selected = null;
      await this.reload();
    } catch (e) {
      console.error('Iconic | removing the preset failed', e);
      ui.notifications?.error?.(t('ICONIC.Presets.Errors.RemoveFailed'));
    }
  }

  async close(options = {}) {
    this._observer?.disconnect();
    this._observer = null;
    return super.close(options);
  }
}
