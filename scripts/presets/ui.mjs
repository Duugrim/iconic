// Small helpers shared by the presets' windows and strip.

export function t(key, data) {
  try {
    return data ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch (_) {
    return key;
  }
}

/**
 * Makes an element. Text goes in as text, never as HTML: names come from files anyone can edit.
 * @param {string} tag
 * @param {object} [props] `class`, `text`, `data` (dataset), the rest as attributes (false and null skipped)
 * @param {Array<Node|string>} [children]
 */
export function el(tag, { class: className, text, data, ...attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (data) Object.assign(node.dataset, data);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== false && value !== null && value !== undefined) node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

/** A Font Awesome icon. */
export function icon(name) {
  return el('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
}

/** A hover text that is HTML: Foundry 14 reads it from data-tooltip-html, Foundry 13 from data-tooltip. */
export function setHtmlTooltip(node, html) {
  node.dataset.tooltip = html;
  node.dataset.tooltipHtml = html;
}
