# How Chroma and Saturation Are Different

**Source:** [Color Nerd](https://www.youtube.com/@ColorNerd1) (YouTube Shorts)
**Date:** 2023-03-29
**URL:** https://www.youtube.com/shorts/IlpD9DXiH-c
**Views:** 58,545

## Description

Clear visual explanation of the difference between chroma and saturation — two measures of color intensity that are often confused.

## Transcript

Chroma and saturation are both measures of a color's intensity, so what's the difference?

Chroma compares a color's colorfulness to a gray of the same lightness. This green has low chroma, this green has medium chroma, and this green has high chroma. And even though they have different lightnesses, these all have the same chroma. But they don't have the same saturation.

Saturation describes a color's colorfulness in proportion to its brightness. That means that these greens, following a line down to black, have the same saturation — in this case full saturation at their given level of brightness.

So chroma increases as we go out from the central axis of the color space. Saturation increases as we tip away from white.

## Key Concepts

- **Chroma** — colorfulness compared to a gray of the same lightness; increases as you move outward from the central (neutral) axis of the color space
- **Saturation** — colorfulness in proportion to brightness; increases as you "tip away from white" (angle from the white point toward black)
- **Same chroma, different saturation:** colors at different lightnesses but same distance from the neutral axis share chroma but differ in saturation
- **Same saturation, different chroma:** colors along a line from a chromatic color down to black share saturation but differ in chroma
- **Practical implication:** in HSL, "saturation" is not true saturation; in LCH/OKLCH, "C" is chroma; in HWB/HSV, the S dimension is closer to true saturation

## Companion: Peter T Donahue — Interactive Saturation vs. Chroma Visualization

**Source:** [Color Nerd](https://www.youtube.com/@ColorNerd1) (YouTube Shorts)
**URL:** https://www.youtube.com/shorts/xhYNtMvWbZ4
**Interactive:** https://petertdonahue.com/Saturation-vs-Chroma.html

### Transcript

Different hues reach their full chroma at different lightness levels, giving us hue planes of different shapes. This blue reaches its full chroma at a lightness of 57 out of 100, where 100 is white. But what is chroma? It's how different a color is from a gray of the same lightness. Thus, all the blues along this vertical line are blues of equal chroma, of equal difference from gray. Perceptually speaking, in a perceptually organized hue plane, we can also visualize lines of constant saturation. Saturation can be thought of as a proportional measure of colorfulness. How colorful is a blue compared to its own brightness? This means colors of equal saturation will fall on lines radiating from black. As a color's brightness increases, to maintain saturation, its colorfulness increases proportionally. In computer color pickers, often the space of a hue plane is warped so that the lines of equal saturation are parallel. This is more convenient to the way computers calculate color, but it distorts perceptual differences in color such as chroma. And that distortion becomes apparent when we bring back our lines of equal perceptual distance from gray in this hue plane. To learn more and experiment with this visualization, you can go to my website and find this guy and slide the sliders and push the buttons. Have a good one.

### Key Concepts from the Interactive Visualization

- **CIE Saturation** — "colorfulness of an area judged in proportion to its brightness." A *ratio*: colorfulness ÷ brightness. Measures purity — how free a color is from whitishness relative to its own brightness.
- **CIE Chroma** — "colorfulness of an area judged relative to the brightness of a similarly illuminated area that appears white." An *absolute amount*, not a ratio. Distance from a neutral gray of equal lightness.
- **Equal chroma = vertical lines** in a perceptual hue plane; **equal saturation = lines radiating from black**
- **Computer color pickers warp** the hue plane so saturation lines are parallel — convenient for computation but distorts perceptual chroma

### Iso-Line Behavior (the key insight from the interactive)

| X-axis mode | Iso-saturation lines | Iso-chroma lines |
|-------------|---------------------|-----------------|
| **Saturation** | Vertical (constant saturation per column) | Curve away from black — same absolute chroma needs less saturation as lightness drops |
| **Chroma** | Converge at black point — saturation is a ratio demanding less chroma at low brightness | Vertical (constant chroma regardless of lightness) |

### Color Spaces Referenced

- **DIN 6164 Saturation** — calibrated saturation rings with equal perceptual increments. 24 hue angles, tabulated xy-distances from illuminant C white. Iso-saturation contours are non-circular in CIE xy (bulge toward red/blue, compress toward green).
- **OKLCH Chroma** — Euclidean distance from the achromatic axis in OKLab space. ~0–0.37 at sRGB gamut edge.

### Technical Details

Fixed-theta DIN saturation for stable rendering. X-axis morphs between saturation (0) and chroma (1) via smooth animation. Per-hue chroma LUT maps saturation→chroma through 18 bisection iterations for accurate iso-saturation contours within sRGB gamut.

## Links

- https://petertdonahue.com/Saturation-vs-Chroma.html — interactive visualization
- https://www.youtube.com/shorts/xhYNtMvWbZ4 — companion YouTube short
