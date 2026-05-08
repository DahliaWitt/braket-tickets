# The ColorDisk + Trillium Overlay

**Source:** Peter T. Donahue
**Version:** ColorDisk 6.6: Trillium
**License:** CC BY-NC 2.0 (as stated in the PDF)
**Local PDF:** [pdfs/The ColorDisk 6.6.pdf](pdfs/The ColorDisk 6.6.pdf)

## What It Is

The ColorDisk is an artist tool for reasoning about paint mixtures, complements, and gamut masks. The companion **Trillium** overlay is used to predict how mixtures bend through color space instead of assuming straight-line interpolation.

## Core Claim

The tool explicitly rejects the usual simplification that paint mixing is purely subtractive or follows straight lines between pigments.

Instead, it treats paint mixing as a compromise between:

- subtractive filtering
- optical/integrative mixing
- pigment-specific bias toward additive primaries

That framing lines up well with Briggs, Kuppers, Kubelka-Munk thinking, and the repo's broader "integrated mixing" stance.

## What the Trillium Does

- predicts the **hue/chroma curvature** of two-pigment mixtures
- shows when a pair is likely to run through a near-neutral
- helps estimate hue shifts when **white** is added
- gives artists a more realistic quick heuristic than a standard flat wheel

## Other Uses

- identify **visual complements** based on additive opposition across the wheel
- plan **gamut masks** for harmonious palette selection
- reason about paint mixtures without pretending that all pigments behave symmetrically

## Why It Matters

- Strong practical bridge between color theory and studio use
- Good example of a tool that encodes **curved mixing paths** instead of naive line blending
- Useful companion reference when explaining why blue-yellow paint mixing or tinting behavior often surprises people

## Practical Takeaways

- Do not assume pigment mixtures move on straight lines through a perceptual color space.
- White addition is a hue event as well as a lightness event.
- A wheel becomes more useful when it also encodes likely mixture curvature.
