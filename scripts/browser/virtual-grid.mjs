// A windowed grid: however many items there are, only the cells in (and just around) the viewport exist
// in the DOM. A cell stays bound to its item while that item is in range, so scrolling by a row only
// builds the cells of the row that enters, instead of repainting every cell. This is what keeps a
// library of thousands of icons from lagging the window.

export const DEFAULT_OVERSCAN_ROWS = 2;

export class VirtualGrid {
  /**
   * @param {HTMLElement} root scroll container; give it a height in CSS
   * @param {object} opts
   * @param {number} opts.cell cell edge in px
   * @param {number} [opts.gap] smallest gap between cells in px (columns spread to fill the width)
   * @param {(el: HTMLElement, index: number) => void} opts.render fills a cell for an item
   * @param {(index: number) => void} [opts.onSelect] a cell was chosen (click or arrow keys)
   * @param {(index: number) => void} [opts.onActivate] a cell was double-clicked or Enter was pressed
   */
  constructor(root, { cell, gap = 4, render, onSelect, onActivate }) {
    this.root = root;
    this.cell = cell;
    this.gap = gap;
    this._render = render;
    this._onSelect = onSelect;
    this._onActivate = onActivate;
    this.count = 0;
    this.selected = -1;
    this.cols = 1;
    this._colStep = cell + gap;
    /** @type {Map<number, HTMLElement>} cells in use, by item index */
    this._live = new Map();
    /** @type {HTMLElement[]} cells not in use, kept for reuse */
    this._spare = [];
    this._frame = 0;
    /** Rows kept above and below the viewport; a host may lower it for cells that cost a request each. */
    this.overscan = DEFAULT_OVERSCAN_ROWS;

    root.classList.add('iconic-vgrid');
    root.tabIndex = 0;
    root.setAttribute('role', 'listbox');
    this._sizer = document.createElement('div');
    this._sizer.className = 'iconic-vgrid-sizer';
    root.replaceChildren(this._sizer);

    this._onScroll = () => this._schedule();
    this._onClick = (ev) => {
      const el = ev.target.closest?.('.iconic-cell');
      if (el && !el.hidden) this.select(Number(el.dataset.i));
    };
    this._onDblClick = (ev) => {
      const el = ev.target.closest?.('.iconic-cell');
      if (el && !el.hidden) this._onActivate?.(Number(el.dataset.i));
    };
    this._onKey = (ev) => this._key(ev);
    root.addEventListener('scroll', this._onScroll, { passive: true });
    this._sizer.addEventListener('click', this._onClick);
    this._sizer.addEventListener('dblclick', this._onDblClick);
    root.addEventListener('keydown', this._onKey);
    this._resize = new ResizeObserver(() => this.layout());
    this._resize.observe(root);
    this.layout();
  }

  get rowHeight() {
    return this.cell + this.gap;
  }

  /** Sets the number of items; keeps the scroll position unless `resetScroll`. */
  setCount(count, { resetScroll = false } = {}) {
    this.count = count;
    if (this.selected >= count) this.selected = -1;
    if (resetScroll) this.root.scrollTop = 0;
    this.layout();
  }

  /** Re-renders the visible cells (after the data behind the indexes changed). */
  refresh() {
    this._release();
    this._update();
  }

  select(index, { scroll = false, silent = false } = {}) {
    if (index < 0 || index >= this.count) return;
    this.selected = index;
    if (scroll) this.scrollTo(index);
    this._markSelected();
    if (!silent) this._onSelect?.(index);
  }

  scrollTo(index) {
    const top = Math.floor(index / this.cols) * this.rowHeight;
    const view = this.root.clientHeight;
    if (top < this.root.scrollTop) this.root.scrollTop = top;
    else if (top + this.cell > this.root.scrollTop + view) this.root.scrollTop = top + this.cell - view;
  }

  /** Recomputes columns and sizes from the container's current size; every cell is placed again. */
  layout() {
    const width = this.root.clientWidth;
    const cols = Math.max(1, Math.floor((width + this.gap) / (this.cell + this.gap)));
    this.cols = cols;
    // Spread the columns across the width so the right edge is not ragged.
    this._colStep = cols > 1 ? (width - this.cell) / (cols - 1) : 0;
    const rows = Math.ceil(this.count / cols);
    this._sizer.style.height = `${Math.max(0, rows * this.rowHeight - this.gap)}px`;
    this._release();
    this._update();
  }

  destroy() {
    cancelAnimationFrame(this._frame);
    this._resize.disconnect();
    this.root.removeEventListener('scroll', this._onScroll);
    this.root.removeEventListener('keydown', this._onKey);
    this._sizer.removeEventListener('click', this._onClick);
    this._sizer.removeEventListener('dblclick', this._onDblClick);
    this.root.replaceChildren();
  }

  _schedule() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this._update();
    });
  }

  /** Puts every live cell back into the spare pile (their content is stale from now on). */
  _release() {
    for (const el of this._live.values()) {
      el.hidden = true;
      this._spare.push(el);
    }
    this._live.clear();
  }

  _cellAt(index) {
    let el = this._spare.pop();
    if (!el) {
      el = document.createElement('div');
      el.className = 'iconic-cell';
      el.setAttribute('role', 'option');
      this._sizer.append(el);
    }
    el.hidden = false;
    el.dataset.i = String(index);
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    el.style.transform = `translate(${Math.round(col * this._colStep)}px, ${row * this.rowHeight}px)`;
    el.classList.toggle('is-selected', index === this.selected);
    return el;
  }

  _update() {
    const { cols, rowHeight } = this;
    const view = this.root.clientHeight || rowHeight;
    const totalRows = Math.ceil(this.count / cols);
    const firstRow = Math.max(0, Math.floor(this.root.scrollTop / rowHeight) - this.overscan);
    const lastRow = Math.min(totalRows - 1, Math.ceil((this.root.scrollTop + view) / rowHeight) + this.overscan);
    const first = firstRow * cols;
    const last = Math.min(this.count - 1, (lastRow + 1) * cols - 1);

    for (const [index, el] of this._live) {
      if (index < first || index > last) {
        el.hidden = true;
        this._spare.push(el);
        this._live.delete(index);
      }
    }
    for (let i = first; i <= last; i++) {
      if (this._live.has(i)) continue;
      const el = this._cellAt(i);
      this._live.set(i, el);
      this._render(el, i);
    }
  }

  _markSelected() {
    for (const [index, el] of this._live) el.classList.toggle('is-selected', index === this.selected);
  }

  _key(ev) {
    if (this.count === 0) return;
    const cur = this.selected < 0 ? 0 : this.selected;
    const page = this.cols * Math.max(1, Math.floor(this.root.clientHeight / this.rowHeight) - 1);
    let next = null;
    switch (ev.key) {
      case 'ArrowRight': next = cur + 1; break;
      case 'ArrowLeft': next = cur - 1; break;
      case 'ArrowDown': next = cur + this.cols; break;
      case 'ArrowUp': next = cur - this.cols; break;
      case 'PageDown': next = cur + page; break;
      case 'PageUp': next = cur - page; break;
      case 'Home': next = 0; break;
      case 'End': next = this.count - 1; break;
      case 'Enter':
        if (this.selected >= 0) {
          ev.preventDefault();
          this._onActivate?.(this.selected);
        }
        return;
      default: return;
    }
    ev.preventDefault();
    this.select(Math.min(this.count - 1, Math.max(0, next)), { scroll: true });
  }
}
