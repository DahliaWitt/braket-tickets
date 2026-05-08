# coolors.co Does Not Generate Palettes

## The Evidence

In `coolors.co/assets/js/dist/script.min.js`, the "generate" function draws from a hardcoded array of **7,821 pre-made 5-color palettes** embedded directly in the JavaScript bundle:

```javascript
on=[["ff9fb2","fbdce2","0acdff","60ab9a","dedee0"],["9e6240","dea47e","cd4631","f8f2dc","81adc8"],["3b429f","aa7dce","f5d7e3","f4a5ae","a8577e"], ... ]
```

- Variable: `on`
- Array length: 445,443 characters
- Contains: **7,821 palettes** of 5 hex colors each
- The `generatePalette` function picks from this array, filtered by locked colors

There is no color science, no algorithm, no perceptual model. It's a lookup from a static list.

## What "Generate" Actually Does

When you press the spacebar on coolors.co:

1. Check which colors are locked
2. Pick a random palette from the `on` array that matches locked constraints
3. Display it

That's it. The palette was made by someone else, stored in the bundle.

## Tools That Do Generate

- **mycolor.space** — generates from a base color
- **color.adobe.com/create/color-wheel** — geometric hue rotation
- **paletton.com** — hue rotation with saturation/brightness control
- **khroma.co** — ML-trained on user preferences
- **colormind.io** — GAN-based deep learning, trained on Adobe Color + Dribbble + photos/movies; different datasets loaded daily

## Tools With More Control

| Tool                    | Algorithm                                                          |
| ----------------------- | ------------------------------------------------------------------ |
| **RampenSau**           | Hue cycling + easing functions in any color space                  |
| **Poline**              | Anchor interpolation with per-axis position functions              |
| **pro-color-harmonies** | Adaptive OKLCH harmony with muddy-zone avoidance                   |
| **dittoTones**          | Extract lightness/chroma curves from Tailwind/Radix                |
| **FarbVelo**            | Structured random with HSLuv hue selection + CIE Lab interpolation |
| **IQ Cosine**           | `a + b*cos(2π(ct+d))` — 12 floats = infinite palette               |
| **Colorbox**            | Helical paths with configurable easing curves                      |
