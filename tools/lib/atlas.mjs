// Thumbnail atlases: many game-icons drawn as white silhouettes on one transparent sheet.
// The browser colors them with a CSS mask, so one sheet serves any icon color and is a single
// image request instead of hundreds of small SVG ones.

import { encodeMaskPng } from './png-mask.mjs';

/** The 512-unit square game-icons draws its black backdrop with; stripped for thumbnails. */
const BACKDROP = '<path d="M0 0h512v512H0z"/>';

/** @param {string} svgText one game-icons SVG; @returns {{viewBox: string, inner: string}} */
export function iconParts(svgText) {
  const text = String(svgText ?? '');
  const open = text.match(/<svg\b[^>]*>/);
  const close = text.lastIndexOf('</svg>');
  if (!open || close < 0) return { viewBox: '0 0 512 512', inner: '' };
  const viewBox = (open[0].match(/viewBox="([^"]*)"/) || [])[1] || '0 0 512 512';
  const inner = text.slice(open.index + open[0].length, close).replace(BACKDROP, '');
  return { viewBox, inner };
}

/**
 * One sheet as SVG text.
 * @param {string[]} svgTexts icons in cell order
 * @param {{cell: number, cols: number, rows?: number, pad?: number}} layout cell size in px, columns, rows
 *   (give it for every sheet so a short last sheet keeps the full height the browser's mask size expects),
 *   inset around the art
 */
export function buildSheetSvg(svgTexts, { cell, cols, rows: fixedRows, pad = 2 }) {
  const rows = fixedRows ?? Math.max(1, Math.ceil(svgTexts.length / cols));
  const width = cols * cell;
  const height = rows * cell;
  const art = cell - pad * 2;
  const cells = svgTexts.map((text, i) => {
    const { viewBox, inner } = iconParts(text);
    const x = (i % cols) * cell + pad;
    const y = Math.floor(i / cols) * cell + pad;
    return `<svg x="${x}" y="${y}" width="${art}" height="${art}" viewBox="${viewBox}" fill="#fff">${inner}</svg>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${cells.join('')}</svg>`;
}

/**
 * Where an icon sits on its sheet.
 * @returns {{sheet: number, col: number, row: number}}
 */
export function cellOf(index, { cols, rowsPerSheet }) {
  const perSheet = cols * rowsPerSheet;
  const inSheet = index % perSheet;
  return { sheet: Math.floor(index / perSheet), col: inSheet % cols, row: Math.floor(inSheet / cols) };
}

/**
 * Renders a sheet SVG to a coverage-mask PNG at its own pixel size.
 * @param {string} sheetSvg
 * @param {{levels?: 2|4|16|256}} [opts] coverage levels kept (see encodeMaskPng)
 */
export async function renderPng(sheetSvg, { levels = 16 } = {}) {
  const { Resvg } = await import('@resvg/resvg-js');
  const image = new Resvg(sheetSvg, { fitTo: { mode: 'original' } }).render();
  return encodeMaskPng(image.pixels, image.width, image.height, { levels });
}
