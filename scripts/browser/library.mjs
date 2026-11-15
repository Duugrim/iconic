// The bundled library at runtime: loads the index, filters and searches it in memory, and says where an
// icon's SVG and thumbnail live. Nothing here touches Foundry, so it runs (and is tested) standalone.

const WORD_START = 4;
const NAME_HIT = 2;
const ANY_HIT = 1;

/** @param {string} text */
const norm = (text) => String(text ?? '').toLowerCase().trim();

export class Library {
  /**
   * @param {object} index the parsed library/index.json
   * @param {string} baseUrl URL of the `library` folder, no trailing slash
   * @param {string} [dataPath] the same folder as a Data-relative path (what is stored in documents)
   */
  constructor(index, baseUrl, dataPath = baseUrl) {
    this.baseUrl = baseUrl;
    this.dataPath = dataPath;
    this.thumbs = index.thumbs;
    this.authors = index.authors.map(([folder, name, url, license, count]) => ({ folder, name, url, license, count }));
    this.tags = index.tags.map(([slug, label]) => ({ slug, label }));
    this.groups = index.groups.map(([slug, label, tagIds]) => ({
      slug, label, tagIds, tagSet: new Set(tagIds), count: 0,
    }));
    this.source = index.source;

    /** @type {{i: number, name: string, title: string, author: number, tags: number[], text: string, titleLower: string}[]} */
    this.icons = index.icons.map(([name, title, author, tags], i) => ({
      i,
      name,
      title,
      author,
      tags,
      titleLower: norm(title),
      baseText: norm(`${title} ${name.replace(/-/g, ' ')} ${this.authors[author].name} ${tags.map((t) => this.tags[t].label).join(' ')}`),
      text: '',
    }));
    for (const icon of this.icons) icon.text = icon.baseText;
    for (const icon of this.icons) {
      for (const g of this.groups) if (icon.tags.some((t) => g.tagSet.has(t))) g.count++;
    }
    // Groups with no icons (a tag page that came out empty) would be dead links in the sidebar.
    this.groups = this.groups.filter((g) => g.count > 0);
  }

  /**
   * Makes tags findable by another name too (a translation). Replaces earlier aliases.
   * @param {(tagSlug: string) => string} labelOf the alias text of a tag, '' for none
   */
  setTagAliases(labelOf) {
    const alias = this.tags.map((t) => norm(labelOf(t.slug)));
    for (const icon of this.icons) {
      const extra = icon.tags.map((id) => alias[id]).filter(Boolean).join(' ');
      icon.text = extra ? `${icon.baseText} ${extra}` : icon.baseText;
    }
  }

  /** Tags of one group with their icon counts (the group's own tag first). */
  subTags(groupSlug) {
    const group = this.groups.find((g) => g.slug === groupSlug);
    if (!group) return [];
    return group.tagIds.map((id) => ({
      id,
      slug: this.tags[id].slug,
      label: this.tags[id].label,
      count: this.icons.reduce((n, icon) => n + (icon.tags.includes(id) ? 1 : 0), 0),
    })).filter((t) => t.count > 0);
  }

  /**
   * Indexes of the icons to show.
   * @param {{text?: string, group?: string, tag?: number}} [query] group slug and tag id narrow the set; text must match every word
   * @returns {number[]} icon indexes: library order when unfiltered, relevance order for text, title order otherwise
   */
  search({ text = '', group = '', tag = -1 } = {}) {
    let pool = this.icons;
    const g = group ? this.groups.find((x) => x.slug === group) : null;
    if (g) pool = pool.filter((icon) => icon.tags.some((t) => g.tagSet.has(t)));
    if (tag >= 0) pool = pool.filter((icon) => icon.tags.includes(tag));

    const words = norm(text).split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (!g && tag < 0) return pool.map((icon) => icon.i);
      return pool.slice().sort((a, b) => a.titleLower.localeCompare(b.titleLower) || a.i - b.i).map((icon) => icon.i);
    }

    const scored = [];
    for (const icon of pool) {
      let score = 0;
      let ok = true;
      for (const w of words) {
        if (!icon.text.includes(w)) {
          ok = false;
          break;
        }
        if (icon.titleLower.startsWith(w) || icon.titleLower.includes(` ${w}`)) score += WORD_START;
        else if (icon.name.includes(w)) score += NAME_HIT;
        else score += ANY_HIT;
      }
      if (ok) scored.push([score, icon]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].titleLower.localeCompare(b[1].titleLower) || a[1].i - b[1].i);
    return scored.map(([, icon]) => icon.i);
  }

  /** Where the thumbnail of icon `i` sits: its sheet number and cell column/row. */
  cellOf(i) {
    const { cols, rows } = this.thumbs;
    const inSheet = i % (cols * rows);
    return { sheet: Math.floor(i / (cols * rows)), col: inSheet % cols, row: Math.floor(inSheet / cols) };
  }

  sheetUrl(sheet) {
    return `${this.baseUrl}/thumbs/sheet-${String(sheet).padStart(2, '0')}.png`;
  }

  /** URL of the icon's SVG file. */
  svgUrl(icon) {
    return `${this.baseUrl}/icons/${this.authors[icon.author].folder}/${icon.name}.svg`;
  }

  /** Data-relative path of the icon's SVG file (what the editor takes as a source). */
  svgPath(icon) {
    return `${this.dataPath}/icons/${this.authors[icon.author].folder}/${icon.name}.svg`;
  }

  /** The icon at an archive folder and file name, or undefined. */
  byFolderAndName(folder, name) {
    return this.icons.find((icon) => icon.name === name && this.authors[icon.author].folder === folder);
  }

  /** Public page of the icon on the library's source site. */
  pageUrl(icon) {
    return `${this.source}/1x1/${this.authors[icon.author].folder}/${icon.name}.html`;
  }
}

/**
 * Loads the index.
 * @param {string} baseUrl URL of the `library` folder
 * @param {{dataPath?: string, fetchImpl?: typeof fetch}} [opts]
 */
export async function loadLibrary(baseUrl, { dataPath = baseUrl, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${baseUrl}/index.json`);
  if (!res.ok) throw new Error(`Iconic library index: HTTP ${res.status}`);
  return new Library(await res.json(), baseUrl, dataPath);
}
