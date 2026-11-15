// Attribution for icons of the bundled library. game-icons.net icons are CC BY 3.0 (some authors CC0):
// whoever redistributes or adapts them has to credit the author. A baked SVG carries the credit inside
// the file, so it travels with the picture wherever it is copied.

import { getLibrary, parseLibraryIconPath } from './library-source.mjs';

/**
 * One-line credit.
 * @param {{title: string, author: string, license: string, url: string}} info
 */
export function creditLine({ title, author, license, url }) {
  return `Icon "${title}" made by ${author} (${license}), available on ${url}. Recolored and restyled with Iconic.`;
}

/**
 * The credit text for a source path, or '' when the path is not a bundled-library icon.
 * @param {string} path Data-relative path of the source SVG
 */
export async function creditForPath(path) {
  const parsed = parseLibraryIconPath(path);
  if (!parsed) return '';
  const library = await getLibrary();
  const icon = library?.byFolderAndName(parsed.folder, parsed.name);
  if (!icon) return '';
  const author = library.authors[icon.author];
  return creditLine({ title: icon.title, author: author.name, license: author.license, url: library.pageUrl(icon) });
}
