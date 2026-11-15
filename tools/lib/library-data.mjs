// Pure data helpers for building the bundled game-icons.net library (no file or network access here).

const BADGES_FOLDER = 'badges';
export const UNCATEGORIZED_GROUP = { slug: 'other', label: 'Other' };

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
const decode = (s) => String(s ?? '').replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m]);

/**
 * The tag overview page (game-icons.net/tags.html): site groups with their sub-tags.
 * A list item of class "parent" holds a group (first link) followed by its sub-tags; class "icon" is a
 * group of one tag.
 * @returns {{slug: string, label: string, count: number, children: {slug: string, label: string, count: number}[]}[]}
 */
export function parseTagIndex(html) {
  const list = String(html).split('<ul class="tags cover">')[1]?.split('</ul>')[0] ?? '';
  const groups = [];
  for (const li of list.split('<li').slice(1)) {
    const tags = [...li.matchAll(/<a href="\/tags\/([^"]+)\.html">.*?\/>(.*?)<\/a>/g)].map((m) => {
      const label = decode(m[2].replace(/<span.*$/, ''));
      const parts = label.match(/^(.*?)\s+—\s+(\d+)$/);
      return { slug: m[1], label: parts ? parts[1] : label, count: parts ? Number(parts[2]) : 0 };
    });
    if (!tags.length) continue;
    groups.push({ ...tags[0], children: tags.slice(1) });
  }
  return groups;
}

/**
 * One tag page (game-icons.net/tags/<slug>.html): its icons with their display titles.
 * @returns {{author: string, name: string, title: string}[]}
 */
export function parseTagPage(html) {
  const out = [];
  const re = /<li data-hint="([^"]*)"[^>]*><a href="\/1x1\/([^/"]+)\/([^"]+)\.html">/g;
  for (const m of String(html).matchAll(re)) out.push({ title: decode(m[1]), author: m[2], name: m[3] });
  return out;
}

const alnum = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Archive folders whose contributor is listed under a different name in license.txt. */
const AUTHOR_LIST_NAMES = { lucasms: 'Lucas' };

/**
 * The contributor list of the archive's license.txt ("- Name, https://url - CC0").
 * @returns {Map<string, {name: string, url: string, license: string}>} keyed by the letters-and-digits form of the name
 */
export function parseAuthors(licenseText) {
  const map = new Map();
  for (const line of String(licenseText).split(/\r?\n/)) {
    const m = line.match(/^- (.+)$/);
    if (!m) continue;
    let rest = m[1].trim();
    let license = 'CC BY 3.0';
    const cc0 = rest.match(/\s+-\s+CC0\s*$/);
    if (cc0) {
      license = 'CC0 1.0';
      rest = rest.slice(0, cc0.index).trim();
    }
    const comma = rest.indexOf(', ');
    const name = comma < 0 ? rest : rest.slice(0, comma);
    const url = comma < 0 ? '' : rest.slice(comma + 2).trim();
    map.set(alnum(name), { name, url, license });
  }
  return map;
}

/** "acid-blob" -> "Acid blob" (for icons no tag page names). */
export function humanizeName(name) {
  const text = String(name).replace(/-/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Builds the library index.
 * @param {object} input
 * @param {{author: string, name: string}[]} input.icons every shipped icon (badges excluded by the caller)
 * @param {ReturnType<typeof parseTagIndex>} input.tagTree
 * @param {Record<string, ReturnType<typeof parseTagPage>>} input.tagPages icons per tag slug
 * @param {ReturnType<typeof parseAuthors>} input.authorInfo
 * @param {{cell: number, cols: number, rows: number}} input.thumbs sheet geometry
 * @returns {{index: object, report: {untagged: number, unknownInTags: string[], authorsWithoutInfo: string[]}}}
 */
export function buildIndex({ icons, tagTree, tagPages, authorInfo, thumbs }) {
  // Tag table and group table.
  const tags = [];
  const tagId = new Map();
  const groups = [];
  const addTag = (t) => {
    if (!tagId.has(t.slug)) {
      tagId.set(t.slug, tags.length);
      tags.push([t.slug, t.label]);
    }
    return tagId.get(t.slug);
  };
  for (const g of tagTree) {
    groups.push([g.slug, g.label, [addTag(g), ...g.children.map(addTag)]]);
  }
  const groupOfTag = new Map();
  groups.forEach((g, gi) => g[2].forEach((t) => groupOfTag.set(t, gi)));
  const tagCount = new Map();

  // Per-icon tags and titles from the tag pages.
  const key = (author, name) => `${author}/${name}`;
  const shipped = new Set(icons.map((i) => key(i.author, i.name)));
  const iconTags = new Map();
  const iconTitle = new Map();
  const unknownInTags = new Set();
  for (const [slug, list] of Object.entries(tagPages)) {
    const id = tagId.get(slug);
    if (id === undefined) continue;
    for (const entry of list) {
      const k = key(entry.author, entry.name);
      if (!shipped.has(k)) {
        unknownInTags.add(k);
        continue;
      }
      if (!iconTags.has(k)) iconTags.set(k, []);
      iconTags.get(k).push(id);
      if (!iconTitle.has(k)) iconTitle.set(k, entry.title);
      tagCount.set(id, (tagCount.get(id) ?? 0) + 1);
    }
  }

  // A few icons are missing from the tag pages (the site lags behind its own archive). Such an icon
  // takes the tags most of its same-author siblings with the same first name word share, e.g. the
  // tarot cards that are not yet listed.
  const firstWord = (name) => name.split('-')[0];
  for (const icon of icons) {
    const k = key(icon.author, icon.name);
    if (iconTags.has(k)) continue;
    const siblings = icons.filter((o) => o !== icon && o.author === icon.author
      && firstWord(o.name) === firstWord(icon.name) && iconTags.has(key(o.author, o.name)));
    if (siblings.length < 3) continue;
    const votes = new Map();
    for (const o of siblings) for (const t of iconTags.get(key(o.author, o.name))) votes.set(t, (votes.get(t) ?? 0) + 1);
    const inherited = [...votes].filter(([, n]) => n * 2 >= siblings.length).map(([t]) => t);
    if (inherited.length) iconTags.set(k, inherited);
  }

  // Icons with no tag at all go to a synthetic last group.
  let otherGroup = -1;
  const ensureOther = () => {
    if (otherGroup < 0) {
      const id = addTag(UNCATEGORIZED_GROUP);
      otherGroup = groups.length;
      groups.push([UNCATEGORIZED_GROUP.slug, UNCATEGORIZED_GROUP.label, [id]]);
      groupOfTag.set(id, otherGroup);
    }
    return otherGroup;
  };

  // Authors table.
  const authorIdx = new Map();
  const authors = [];
  const authorsWithoutInfo = [];
  const authorOf = (folder) => {
    if (!authorIdx.has(folder)) {
      const info = authorInfo.get(alnum(AUTHOR_LIST_NAMES[folder] ?? folder));
      if (!info) authorsWithoutInfo.push(folder);
      authorIdx.set(folder, authors.length);
      authors.push([folder, info?.name ?? humanizeName(folder), info?.url ?? '', info?.license ?? 'CC BY 3.0', 0]);
    }
    return authorIdx.get(folder);
  };

  let untagged = 0;
  const rows = icons.map((icon) => {
    const k = key(icon.author, icon.name);
    let own = iconTags.get(k);
    let primary;
    if (own?.length) {
      // The rarest tag is the most specific one; its group decides where the icon sits in the sheets.
      const rarest = own.reduce((a, b) => ((tagCount.get(b) ?? 0) < (tagCount.get(a) ?? 0) ? b : a));
      primary = groupOfTag.get(rarest);
      own = [...new Set(own)].sort((a, b) => a - b);
    } else {
      untagged++;
      primary = ensureOther();
      own = [tagId.get(UNCATEGORIZED_GROUP.slug)];
    }
    const author = authorOf(icon.author);
    authors[author][4]++;
    return { primary, title: iconTitle.get(k) ?? humanizeName(icon.name), row: [icon.name, '', author, own] };
  });

  rows.sort((a, b) => a.primary - b.primary
    || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
    || a.row[0].localeCompare(b.row[0]));
  const out = rows.map((r) => {
    r.row[1] = r.title;
    return r.row;
  });
  const perSheet = thumbs.cols * thumbs.rows;

  return {
    index: {
      format: 1,
      source: 'https://game-icons.net',
      thumbs: { ...thumbs, sheets: Math.ceil(out.length / perSheet) },
      authors,
      tags,
      groups,
      icons: out,
    },
    report: { untagged, unknownInTags: [...unknownInTags], authorsWithoutInfo },
  };
}

/** Public page of an icon on game-icons.net. */
export function iconPageUrl(author, name) {
  return `https://game-icons.net/1x1/${author}/${name}.html`;
}

/** CREDITS.md: license summary, authors, and every shipped icon under its author. */
export function creditsMarkdown(index) {
  const lines = [];
  lines.push('# Credits', '');
  lines.push('The bundled icon library is made of the icons of [game-icons.net](https://game-icons.net), '
    + 'drawn by the contributors listed below. They are licensed under '
    + '[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) (CC BY 3.0); '
    + 'the icons of the authors marked CC0 are released into the public domain '
    + '([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)). '
    + 'The archive\'s own notice is kept in `library/license.txt`.', '');
  lines.push('Icons made by the authors below. Available on https://game-icons.net', '');
  lines.push('Icons you recolor, restyle or put on a background with Iconic are adaptations of these works; '
    + 'the author and license stay recorded inside each generated SVG file.', '');
  lines.push('## Authors', '', '| Author | Icons | License | Link |', '| --- | ---: | --- | --- |');
  const sorted = [...index.authors].sort((a, b) => b[4] - a[4] || a[1].localeCompare(b[1]));
  for (const [, name, url, license, count] of sorted) {
    lines.push(`| ${name} | ${count} | ${license} | ${url ? `<${url}>` : ''} |`);
  }
  lines.push('', '## Icons by author', '');
  const byAuthor = index.authors.map(() => []);
  for (const [, title, author] of index.icons) byAuthor[author].push(title);
  for (const author of sorted) {
    const [, name, , license] = author;
    const titles = byAuthor[index.authors.indexOf(author)].slice()
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    lines.push(`### ${name} (${titles.length}, ${license})`, '', titles.join(', '), '');
  }
  return lines.join('\n');
}
