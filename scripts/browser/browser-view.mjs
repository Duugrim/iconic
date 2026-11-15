// The icon browser's content: search, categories, the windowed grid and a detail panel, in three tabs
// (bundled library, icons the user made, the user's own SVG files). It knows nothing about Foundry
// windows: the host passes in a root element and a few services, so it runs in a plain page too.

import { DEFAULT_OVERSCAN_ROWS, VirtualGrid } from './virtual-grid.mjs';
import { paintThumb, setThumbGeometry } from './thumbs.mjs';
import { buildBakedSvgText, normalizeBakeOptions, stripSvgBackground } from '../lib/svg-bake.mjs';

export const TABS = ['library', 'created', 'custom'];

const CELL = 56;
const GAP = 6;
const SEARCH_DEBOUNCE_MS = 120;
/** Rows kept above/below the viewport for file thumbnails: each cell there is a real file request. */
const FILE_OVERSCAN_ROWS = 1;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @typedef {object} BrowserServices
 * @property {import('./library.mjs').Library | null} library bundled library (null if its files are missing)
 * @property {(key: string, data?: object) => string} t localize / format a string
 * @property {() => Promise<{path: string, name: string, folder: string}[]>} listCreated files of the output folder, newest first
 * @property {() => Promise<{path: string, name: string, folder: string}[]>} listCustom the user's own SVGs (folder = sub-folder name or '')
 * @property {(path: string) => string} fileUrl URL the browser can load a Data path from
 * @property {(path: string) => Promise<string>} fetchText fetches a file's text
 * @property {string} customFolder folder of the user's own SVGs, shown in hints
 * @property {() => void} chooseFile open a general file picker instead
 * @property {() => void} openCustomFolder open a file browser at the custom folder (to upload)
 * @property {(result: {path: string, source: string}) => void} onPick
 * @property {() => void} onCancel
 */

export class BrowserView {
  /**
   * @param {HTMLElement} root
   * @param {BrowserServices} services
   * @param {{tab?: string, selectedPath?: string}} [options]
   */
  constructor(root, services, { tab = 'library' } = {}) {
    this.root = root;
    this.s = services;
    this.tab = TABS.includes(tab) ? tab : 'library';
    this.query = '';
    this.group = '';
    this.tag = -1;
    /** @type {{kind: 'library', icon: object} | {kind: 'file', file: object} | null} */
    this.selected = null;
    this.shown = []; // library: icon indexes; files: file objects
    this._files = { created: null, custom: null };
    this._token = 0;
    this._build();
    this.setTab(this.tab);
  }

  destroy() {
    clearTimeout(this._searchTimer);
    this.grid?.destroy();
    this.root.replaceChildren();
  }

  // ---- structure ----

  _build() {
    const t = this.s.t;
    this.root.classList.add('iconic-browser');
    this.root.innerHTML = `
      <header class="iconic-browser__top">
        <input type="search" class="iconic-browser__search" placeholder="${esc(t('ICONIC.Browser.SearchPlaceholder'))}"
          aria-label="${esc(t('ICONIC.Browser.SearchPlaceholder'))}" autocomplete="off" spellcheck="false">
        <nav class="iconic-browser__tabs" role="tablist">
          ${TABS.map((id) => `<button type="button" role="tab" data-tab="${id}">${esc(t(`ICONIC.Browser.Tabs.${id.charAt(0).toUpperCase()}${id.slice(1)}`))}</button>`).join('')}
        </nav>
        <span class="iconic-browser__count"></span>
      </header>
      <div class="iconic-browser__body">
        <nav class="iconic-browser__groups" aria-label=""></nav>
        <section class="iconic-browser__main">
          <div class="iconic-browser__chips"></div>
          <div class="iconic-browser__grid"></div>
          <p class="iconic-browser__empty" hidden></p>
        </section>
        <aside class="iconic-browser__detail"></aside>
      </div>
      <footer class="iconic-browser__foot">
        <button type="button" data-act="choose-file"><i class="fa-solid fa-folder-open" aria-hidden="true"></i> ${esc(t('ICONIC.Browser.Buttons.ChooseFile'))}</button>
        <button type="button" data-act="add-custom"><i class="fa-solid fa-upload" aria-hidden="true"></i> ${esc(t('ICONIC.Browser.Buttons.AddCustom'))}</button>
        <span class="iconic-browser__spacer"></span>
        <button type="button" data-act="cancel">${esc(t('ICONIC.Browser.Buttons.Cancel'))}</button>
        <button type="button" class="iconic-browser__ok" data-act="select" disabled><i class="fa-solid fa-check" aria-hidden="true"></i> ${esc(t('ICONIC.Browser.Buttons.Select'))}</button>
      </footer>`;

    const $ = (sel) => this.root.querySelector(sel);
    this.el = {
      search: $('.iconic-browser__search'),
      tabs: $('.iconic-browser__tabs'),
      count: $('.iconic-browser__count'),
      groups: $('.iconic-browser__groups'),
      chips: $('.iconic-browser__chips'),
      grid: $('.iconic-browser__grid'),
      empty: $('.iconic-browser__empty'),
      detail: $('.iconic-browser__detail'),
      select: $('[data-act="select"]'),
      addCustom: $('[data-act="add-custom"]'),
    };

    this.grid = new VirtualGrid(this.el.grid, {
      cell: CELL,
      gap: GAP,
      render: (el, i) => this._renderCell(el, i),
      onSelect: (i) => this._select(i),
      onActivate: (i) => {
        this._select(i);
        this._confirm();
      },
    });
    if (this.s.library) {
      setThumbGeometry(this.el.grid, this.s.library.thumbs, CELL);
      // search finds a tag by its translated name as well ("оружие" finds weapons)
      this.s.library.setTagAliases((slug) => this._tagLabel(slug, ''));
    }

    this.el.search.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.query = this.el.search.value;
        this._refilter({ resetScroll: true });
      }, SEARCH_DEBOUNCE_MS);
    });
    this.el.tabs.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tab]');
      if (b) this.setTab(b.dataset.tab);
    });
    this.el.groups.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-group]');
      if (!b) return;
      this.group = b.dataset.group;
      this.tag = -1;
      this._renderGroups();
      this._refilter({ resetScroll: true });
    });
    this.el.chips.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tag]');
      if (!b) return;
      this.tag = Number(b.dataset.tag);
      this._renderChips();
      this._refilter({ resetScroll: true });
    });
    this.el.detail.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tag-filter]');
      if (!b || this.tab !== 'library') return;
      // Jump to the tag inside its category, so the sidebar and the chips show what is filtered.
      const tag = Number(b.dataset.tagFilter);
      this.group = this.s.library.groups.find((g) => g.tagSet.has(tag))?.slug ?? '';
      this.tag = tag;
      this._renderGroups();
      this._refilter({ resetScroll: true });
    });
    this.root.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-act]')?.dataset.act;
      if (act === 'choose-file') this.s.chooseFile();
      else if (act === 'add-custom') this.s.openCustomFolder();
      else if (act === 'cancel') this.s.onCancel();
      else if (act === 'select') this._confirm();
    });
  }

  // ---- tabs and data ----

  async setTab(tab) {
    this.tab = TABS.includes(tab) ? tab : 'library';
    const token = ++this._token;
    for (const b of this.el.tabs.querySelectorAll('[data-tab]')) {
      b.setAttribute('aria-selected', String(b.dataset.tab === this.tab));
      b.classList.toggle('is-active', b.dataset.tab === this.tab);
    }
    this.group = '';
    this.tag = -1;
    this.selected = null;
    this.el.addCustom.hidden = this.tab !== 'custom';
    this.grid.overscan = this.tab === 'library' ? DEFAULT_OVERSCAN_ROWS : FILE_OVERSCAN_ROWS;
    this.el.empty.hidden = true;

    if (this.tab !== 'library' && !this._files[this.tab]) {
      this.el.count.textContent = this.s.t('ICONIC.Browser.Loading');
      this.shown = [];
      this.grid.setCount(0, { resetScroll: true });
      try {
        const list = await (this.tab === 'created' ? this.s.listCreated() : this.s.listCustom());
        if (token !== this._token) return;
        this._files[this.tab] = list;
      } catch (e) {
        console.error('Iconic | listing failed', e);
        if (token !== this._token) return;
        this._files[this.tab] = [];
      }
    }
    this._renderGroups();
    this._refilter({ resetScroll: true });
  }

  /** Re-reads a file tab next time it is opened (after the user added files). */
  invalidateFiles() {
    this._files = { created: null, custom: null };
  }

  _fileGroups() {
    const counts = new Map();
    for (const f of this._files[this.tab] ?? []) counts.set(f.folder, (counts.get(f.folder) ?? 0) + 1);
    return counts;
  }

  _refilter({ resetScroll = false } = {}) {
    const lib = this.s.library;
    if (this.tab === 'library') {
      this.shown = lib ? lib.search({ text: this.query, group: this.group, tag: this.tag }) : [];
    } else {
      const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
      this.shown = (this._files[this.tab] ?? []).filter((f) => (!this.group || f.folder === this.group)
        && words.every((w) => f.name.toLowerCase().includes(w)));
    }
    const total = this.tab === 'library' ? (lib?.icons.length ?? 0) : (this._files[this.tab]?.length ?? 0);
    this.el.count.textContent = this.s.t('ICONIC.Browser.Count', { shown: this.shown.length, total });
    this.grid.setCount(this.shown.length, { resetScroll });
    this._renderChips();
    this._renderEmpty();
    // keep the selection only if it is still visible
    if (this.selected && this._indexOfSelected() < 0) this.selected = null;
    else if (this.selected) this.grid.select(this._indexOfSelected(), { silent: true });
    this._renderDetail();
  }

  _indexOfSelected() {
    if (!this.selected) return -1;
    return this.tab === 'library'
      ? this.shown.indexOf(this.selected.icon.i)
      : this.shown.indexOf(this.selected.file);
  }

  // ---- sidebar, chips, empty state ----

  _renderGroups() {
    const t = this.s.t;
    const lib = this.s.library;
    const rows = [];
    if (this.tab === 'library' && lib) {
      rows.push([ '', t('ICONIC.Browser.AllIcons'), lib.icons.length ]);
      for (const g of lib.groups) rows.push([g.slug, this._tagLabel(g.slug, g.label), g.count]);
    } else if (this.tab === 'custom') {
      const groups = this._fileGroups();
      if (groups.size > 1 || (groups.size === 1 && !groups.has(''))) {
        rows.push(['', t('ICONIC.Browser.AllIcons'), this._files.custom.length]);
        for (const [folder, n] of [...groups].filter(([f]) => f).sort((a, b) => a[0].localeCompare(b[0]))) {
          rows.push([folder, folder, n]);
        }
      }
    }
    this.el.groups.hidden = rows.length === 0;
    this.el.groups.innerHTML = rows.map(([slug, label, n]) => `
      <button type="button" data-group="${esc(slug)}" class="${slug === this.group ? 'is-active' : ''}">
        <span>${esc(label)}</span><small>${n}</small>
      </button>`).join('');
  }

  _renderChips() {
    const lib = this.s.library;
    let html = '';
    if (this.tab === 'library' && lib && this.group) {
      const subs = lib.subTags(this.group);
      if (subs.length > 1) {
        html = `<button type="button" data-tag="-1" class="${this.tag < 0 ? 'is-active' : ''}">${esc(this.s.t('ICONIC.Browser.AllTags'))}</button>`
          + subs.map((s) => `<button type="button" data-tag="${s.id}" class="${s.id === this.tag ? 'is-active' : ''}">${esc(this._tagLabel(s.slug, s.label))} <small>${s.count}</small></button>`).join('');
      }
    }
    this.el.chips.hidden = !html;
    this.el.chips.innerHTML = html;
  }

  _renderEmpty() {
    const t = this.s.t;
    let text = '';
    const loading = this.tab !== 'library' && this._files[this.tab] === null;
    if (this.tab === 'library' && !this.s.library) text = t('ICONIC.Browser.Errors.LibraryMissing');
    else if (!loading && this.shown.length === 0) {
      if (this.query || this.group || this.tag >= 0 || this.tab === 'library') text = t('ICONIC.Browser.Empty.NoResults');
      else if (this.tab === 'created') text = t('ICONIC.Browser.Empty.Created');
      else text = t('ICONIC.Browser.Empty.Custom', { folder: this.s.customFolder });
    }
    this.el.empty.hidden = !text;
    this.el.empty.textContent = text;
  }

  _tagLabel(slug, fallback) {
    const key = `ICONIC.Library.Tags.${slug}`;
    const v = this.s.t(key);
    return v && v !== key ? v : fallback;
  }

  // ---- cells and selection ----

  _renderCell(el, i) {
    el.classList.toggle('is-file', this.tab !== 'library');
    if (this.tab === 'library') {
      const icon = this.s.library.icons[this.shown[i]];
      paintThumb(el, this.s.library, icon.i, CELL);
      el.title = icon.title;
      return;
    }
    const file = this.shown[i];
    let img = el.firstElementChild;
    if (img?.tagName !== 'IMG') {
      img = document.createElement('img');
      img.className = 'iconic-cellimg';
      img.alt = '';
      img.decoding = 'async';
      el.replaceChildren(img);
    }
    const url = this.s.fileUrl(file.path);
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    el.title = file.name;
  }

  _select(i) {
    if (this.tab === 'library') {
      const icon = this.s.library.icons[this.shown[i]];
      this.selected = icon ? { kind: 'library', icon } : null;
    } else {
      const file = this.shown[i];
      this.selected = file ? { kind: 'file', file } : null;
    }
    this._renderDetail();
  }

  _selectionPath() {
    if (!this.selected) return '';
    if (this.selected.kind === 'library') {
      const lib = this.s.library;
      return lib.svgPath(this.selected.icon);
    }
    return this.selected.file.path;
  }

  _confirm() {
    const path = this._selectionPath();
    if (!path) return;
    this.s.onPick({ path, source: this.tab });
  }

  // ---- detail panel ----

  _renderDetail() {
    const t = this.s.t;
    const sel = this.selected;
    this.el.select.disabled = !sel;
    if (!sel) {
      this.el.detail.innerHTML = `<p class="iconic-browser__hint">${esc(t('ICONIC.Browser.Detail.Nothing'))}</p>`;
      return;
    }
    let title;
    let rows = '';
    let source = '';
    if (sel.kind === 'library') {
      const lib = this.s.library;
      const icon = sel.icon;
      const author = lib.authors[icon.author];
      title = icon.title;
      const authorHtml = author.url
        ? `<a href="${esc(author.url)}" target="_blank" rel="noopener noreferrer">${esc(author.name)}</a>`
        : esc(author.name);
      const tags = icon.tags.map((id) => `<button type="button" class="iconic-browser__tag" data-tag-filter="${id}">${esc(this._tagLabel(lib.tags[id].slug, lib.tags[id].label))}</button>`).join('');
      rows = `
        <dt>${esc(t('ICONIC.Browser.Detail.Author'))}</dt><dd>${authorHtml}</dd>
        <dt>${esc(t('ICONIC.Browser.Detail.License'))}</dt><dd>${esc(author.license)}</dd>
        <dt>${esc(t('ICONIC.Browser.Detail.Tags'))}</dt><dd class="iconic-browser__tags">${tags}</dd>`;
      source = `<a href="${esc(lib.pageUrl(icon))}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> ${esc(t('ICONIC.Browser.Detail.Source'))}</a>`;
    } else {
      title = sel.file.name;
      rows = `<dt>${esc(t('ICONIC.Browser.Detail.File'))}</dt><dd class="iconic-browser__path">${esc(sel.file.path)}</dd>`;
    }
    this.el.detail.innerHTML = `
      <div class="iconic-browser__preview ${sel.kind === 'file' ? 'is-file' : ''}" data-role="preview"></div>
      <h3 class="iconic-browser__title">${esc(title)}</h3>
      <dl>${rows}</dl>
      ${source}`;
    this._loadPreview(sel);
  }

  /** Large preview: the real SVG, recolored for library icons (their files are white on black). */
  async _loadPreview(sel) {
    const box = this.el.detail.querySelector('[data-role="preview"]');
    if (!box) return;
    const path = this._selectionPath();
    try {
      let text = await this.s.fetchText(path);
      if (this.selected !== sel) return;
      if (sel.kind === 'library') {
        const color = getComputedStyle(box).color;
        text = buildBakedSvgText(stripSvgBackground(text), {
          opts: normalizeBakeOptions({ icon: { color: cssColorToHex(color) } }),
          includeMeta: false,
        });
      }
      const img = document.createElement('img');
      img.alt = '';
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      box.replaceChildren(img);
    } catch (e) {
      console.warn('Iconic | preview failed', e);
    }
  }
}

/** 'rgb(12, 34, 56)' -> '#0c2238' (falls back to white). */
export function cssColorToHex(css) {
  const m = String(css).match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return '#ffffff';
  return `#${m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`;
}
