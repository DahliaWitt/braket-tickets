# Color Palette Pro — A Synthesizer for Color Palettes

**URL:** <https://colorpalette.pro/>
**Author:** Ryan Feigenbaum
**Article:** <https://ryanfeigenbaum.com/color-palette-pro/>
**Product Hunt:** <https://www.producthunt.com/products/color-palette-pro>

## Overview

A synthesizer-style interface for generating programmatic color palettes. Built on **Color.js** (by Lea Verou & Chris Lilley, CSS Color spec editors). Free, no ads, no subscriptions.

**Related:** [pro-color-harmonies](pro-color-harmonies.md) is a standalone JS library by @meodai that reimplements the same harmony logic as a dependency-free lib, built with consent from Color Palette Pro's author. Same 4 styles (square/triangle/circle/diamond), but usable programmatically without the web UI.

## Palette Types

Six programmatic palette types, each producing 5–12 colors:

| Type                    | Code | Description                                |
| ----------------------- | ---- | ------------------------------------------ |
| Analogous               | ANA  | Adjacent colors on the color wheel         |
| Complementary           | COM  | Opposed colors on the wheel                |
| Split Complementary     | SPL  | Opposed then bifurcated                    |
| Triadic                 | TRI  | Triangle arrangement on wheel              |
| Tetradic                | TET  | Square arrangement on wheel                |
| Tints & Shades          | TAS  | Base color mixed with white and black (12) |

## Palette Variations (Styles)

Each palette has 4 algorithmic variations:

- **Square** — Raw mathematical relationships with few perceptual adjustments
- **Triangle** — Compensates for perceptual issues (references Bezold-Brücke effect)
- **Circle** — Smooth progressions via white/black blending
- **Diamond** — Tonal variations through neutral gray blending

## Color Spaces

Primary format: **OKLCH**. Also supports:

- OKLAB
- HSL
- LAB
- RGB
- Hex
- Named colors

Sliders adapt based on active color space: lightness/chroma/hue for LCH; lightness/A (green-red)/B (blue-yellow) for LAB.

## Input Methods

1. **Text input** — accepts nearly any CSS color format
2. **Sliders** — adaptive controls per color space
3. **Eyedropper** — browser-native (not available in Firefox/mobile)
4. **History** — stores up to 240 previous colors; right-click to delete
5. **Random** — curated random color selection
6. **URL** — all settings preserved in shareable URLs

## UI Mode

Generates application-appropriate palettes incorporating the base color:

- Light mode → light mode palette
- Dark mode → dark mode palette
- Naming follows Material Design patterns (`surface`, `on-surface` for text/icons)

## Export

- **CSS variables** — palette values with contrast colors (white/black auto-selected)
- **CSS file download** — complete stylesheet with custom property names
- **Palette image** — PNG generation for design tools (Figma-compatible)
- **Clipboard copy** — click individual color values to copy

## Color Naming

API-based system (Go fork of Color Name API) matches hex values to nearest color names. Palette names combine individual color names.

## Design Philosophy

Author's stated gripes with existing palette tools:
- Poor palette quality
- Difficult base color input
- Limited export capabilities
- Excessive options/complexity
- Poor UI applicability

Creator notes: "The best palettes will always be those created by someone with a good eye." The tool is a starting point, not a guarantee.

## Technical Notes

- Built on **Color.js**
- No monetization
- Described as "version 1.0 done" — no further updates planned
- References Josef Albers' *Interaction of Color* (1963)

## Links

- Tool: <https://colorpalette.pro/>
- Author writeup: <https://ryanfeigenbaum.com/color-palette-pro/>
- DEV Community post: <https://dev.to/royalfig/the-color-palette-pro-is-a-synthesizer-for-color-13lb>
- Color.js: <https://colorjs.io/>
