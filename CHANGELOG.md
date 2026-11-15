# Changelog

## Unreleased

- Token Configuration: the "⋮" entry now puts the new image into the form, like a file picked by hand, and it is saved with the window, instead of being written to the token at once. The prototype token window has the entry too.
- Icon tiles: *New icon tile* in the Tiles controls makes an icon and places it on the map as a tile, a movable marker with no actor or item behind it. `api.placeTile()` does the same from a macro.
- Tiles can be restyled: an Iconic button in the HUD of SVG tiles, and the "⋮" menu of the tile sheet.
- Editor: a new layout with a block for everything that has its own color (icon, icon outline, background, field division, background outline, second contour), plus placement. The window is 1120×540 and fits without scrolling.
- Editor: switched-off parts are dimmed instead of hidden, so nothing moves or changes size.
- Editor: every color has a faction button and an invert button. Without a faction color the button is disabled and its tooltip says why: it needs Azimuth or SpaceHolder, or there is no faction here.
- Editor: sliders for opacity, widths, inset, radius and gap.
- Style presets: save the current style, or any part of it, to a library of JSON files in the module's persistent storage, shared between worlds. A color can be saved as "the faction color".
- A strip under the preview keeps the last six styles for one-click use, including the settings a style replaced and the style of each saved icon. Hover shows what a style holds and what a partial load leaves out.
- Style library: search, load whole or in part, rename, delete. Foundry cannot delete files, so a deleted style is hidden and its file stays in `storage/presets`.

## 0.2.0

First public release.

- Icon editor: color, size, opacity, outline, rotation, shift and flip.
- Backgrounds: square, circle, regular hexagon (flat or pointy top) and eight heraldic shields; corner radius, inset, opacity, outline, "fit icon".
- Field division (per pale, fess, bend, chevron, saltire, quarterly and more) and a second contour.
- Contrast hint with one-click fixes, and faction colors offered by the `iconic.colorHints` hook.
- Icon browser over the bundled game-icons.net library (4,000+ icons), with a *Created* tab and *My SVGs*.
- Opens from the sheet menu (Application V2 and V1 sheets) and the actor / item directory context menu.
- English and Russian.
