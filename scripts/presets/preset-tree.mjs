// The checkboxes that say which parts of a style are meant: a box for each block, one for each of its
// fields, so "only the shape of the background" can be picked. Saving and loading both use it.

import { groupFields, isFactionRef } from '../lib/preset-schema.mjs';
import { el, icon, t } from './ui.mjs';

export class FieldTree {
  /**
   * @param {object} options
   * @param {object} options.values preset values: the fields offered, and what their colors look like
   * @param {object} [options.faction] offer "as the faction color" on color fields (saving)
   * @param {boolean} options.faction.supported can there be a faction color in this game at all?
   * @param {string[]} options.faction.linked color fields that start out linked
   * @param {() => void} [options.onChange]
   */
  constructor({ values, faction = null, onChange = () => {} }) {
    this._values = values;
    this._faction = faction;
    this._onChange = onChange;
    this._groups = [];

    // Columns need a box of their own height: in a box that scrolls they would run off to the right.
    const columns = el('div', { class: 'iconic-presets-tree__columns' });
    this.element = el('div', { class: 'iconic-presets-tree' }, [columns]);

    for (const { group, fields } of groupFields(Object.keys(values))) {
      const box = el('input', { type: 'checkbox', 'aria-label': t(`ICONIC.Presets.Groups.${group.label}`) });
      box.checked = true;
      const rows = fields.map((f) => this._fieldRow(f));
      this._groups.push({ box, rows });
      columns.append(el('section', { class: 'iconic-presets-tree__group' }, [
        el('label', { class: 'iconic-presets-tree__head' }, [
          box,
          el('span', { text: t(`ICONIC.Presets.Groups.${group.label}`) }),
        ]),
        el('div', { class: 'iconic-presets-tree__fields' }, rows.map((row) => row.element)),
      ]));
    }

    this.element.addEventListener('change', (ev) => this._onToggle(ev));
    this._sync();
  }

  _fieldRow(field) {
    const value = this._values[field.id];
    const label = t(`ICONIC.Presets.Fields.${field.label}`);
    const box = el('input', { type: 'checkbox', 'aria-label': label });
    box.checked = true;

    const row = { id: field.id, box, link: null };
    const parts = [el('label', { class: 'iconic-presets-tree__field' }, [box, el('span', { text: label })])];

    if (field.kind === 'color') {
      const swatch = el('span', { class: 'iconic-presets-tree__swatch' });
      swatch.style.background = isFactionRef(value) ? value.fallback : value;
      parts.push(swatch);
      if (this._faction) {
        const { element, link } = this._factionToggle(field);
        row.link = link;
        parts.push(element);
      } else if (isFactionRef(value)) {
        parts.push(el('span', {
          class: 'iconic-presets-tree__linked',
          data: { tooltip: t('ICONIC.Presets.Tooltip.Faction') },
        }, [icon('fa-flag')]));
      }
    }

    row.element = el('div', { class: 'iconic-presets-tree__item' }, parts);
    return row;
  }

  /** The tooltip sits on the label: a disabled input takes no pointer events. */
  _factionToggle(field) {
    const { supported, linked } = this._faction;
    const link = el('input', { type: 'checkbox', disabled: !supported, 'aria-label': t('ICONIC.Presets.Save.AsFaction') });
    link.checked = supported && linked.includes(field.id);
    const tip = t(supported ? 'ICONIC.Presets.Save.AsFaction' : 'ICONIC.Presets.Save.FactionUnsupported');
    const element = el('label', { class: 'iconic-presets-tree__faction', data: { tooltip: tip } }, [link, icon('fa-flag')]);
    return { element, link };
  }

  _onToggle(ev) {
    const group = this._groups.find((g) => g.box === ev.target);
    if (group) for (const row of group.rows) row.box.checked = group.box.checked;
    this._sync();
    this._onChange();
  }

  /** A block's box shows its fields: all, none, or some of them. */
  _sync() {
    for (const { box, rows } of this._groups) {
      const on = rows.filter((row) => row.box.checked).length;
      box.checked = on === rows.length;
      box.indeterminate = on > 0 && on < rows.length;
      for (const row of rows) {
        if (row.link) row.link.closest('label').classList.toggle('is-off', !row.box.checked);
      }
    }
  }

  get _rows() {
    return this._groups.flatMap((g) => g.rows);
  }

  /** The ticked fields. */
  get selected() {
    return this._rows.filter((row) => row.box.checked).map((row) => row.id);
  }

  /** The offered fields that are not ticked. */
  get unselected() {
    return this._rows.filter((row) => !row.box.checked).map((row) => row.id);
  }

  /** The ticked color fields to store as the faction color. */
  get linked() {
    return this._rows.filter((row) => row.box.checked && row.link?.checked).map((row) => row.id);
  }
}
