// The editor's low-contrast warning: one line saying what is wrong and swatches that fix it.

/**
 * @param {ReturnType<import('../lib/color.mjs').checkContrast>} check
 * @param {(key: string, data?: object) => string} t localize / format
 * @returns {string} HTML for the hint box, '' when there is nothing to warn about
 */
export function renderContrastHint(check, t) {
  if (!check.applicable || !check.low) return '';

  const swatches = (list, action) => list.map(({ color, ratio }) => {
    const label = t('ICONIC.Editor.Hints.Use', { color, ratio: ratio.toFixed(1) });
    return `<button type="button" class="iconic-editor__swatch" data-action="${action}" data-color="${color}"`
      + ` style="--iconic-swatch: ${color}" aria-label="${label}" data-tooltip="${label}"></button>`;
  }).join('');

  const group = (labelKey, list, action) => (list.length
    ? `<span class="iconic-editor__hintGroup"><span>${t(labelKey)}</span>${swatches(list, action)}</span>`
    : '');

  return `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>`
    + `<span class="iconic-editor__hintText">${t('ICONIC.Editor.Hints.LowContrast', { ratio: check.ratio.toFixed(1) })}</span>`
    + group('ICONIC.Editor.Hints.IconColor', check.suggestions.icon, 'hint-icon-color')
    + group('ICONIC.Editor.Hints.BackgroundColor', check.suggestions.background, 'hint-bg-color');
}
