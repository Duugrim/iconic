// Thumbnails drawn from the atlas sheets. A sheet is a white silhouette image; each cell holds an inner
// element whose background color is cut to the silhouette with a CSS mask, so any icon color costs no
// extra image and a whole screen of icons shares a handful of sheet requests.

/**
 * Sets the CSS variables on the grid container that every thumbnail cell reads.
 * @param {HTMLElement} root the grid container
 * @param {{cols: number, rows: number}} thumbs sheet geometry from the library
 * @param {number} cell displayed cell edge in px
 */
export function setThumbGeometry(root, { cols, rows }, cell) {
  root.style.setProperty('--iconic-cell', `${cell}px`);
  root.style.setProperty('--iconic-mask-size', `${cols * cell}px ${rows * cell}px`);
}

/**
 * Points a grid cell at the thumbnail of a library icon.
 * @param {HTMLElement} el the recycled grid cell
 * @param {import('./library.mjs').Library} library
 * @param {number} i icon index in the library
 * @param {number} cell displayed cell edge in px
 */
export function paintThumb(el, library, i, cell) {
  let thumb = el.firstElementChild;
  if (!thumb?.classList.contains('iconic-thumb')) {
    thumb = document.createElement('i');
    thumb.className = 'iconic-thumb';
    el.replaceChildren(thumb);
  }
  const { sheet, col, row } = library.cellOf(i);
  thumb.style.setProperty('--iconic-sheet', `url("${library.sheetUrl(sheet)}")`);
  thumb.style.setProperty('--iconic-mask-pos', `${-col * cell}px ${-row * cell}px`);
}
