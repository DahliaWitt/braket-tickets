# Pleasing Colour Palette Sorting - Full Results (v2)

**Source:** local PDF report
**Dataset:** 601 curated Lospec palettes
**Color space:** OKLab
**Date:** 2025-12-22
**Attribution note:** no named author surfaced in the extracted text or PDF metadata
**Local PDF:** [pdfs/pleasing_color_sorting_full_results_v2.pdf](pdfs/pleasing_color_sorting_full_results_v2.pdf)

## What It Studies

This report tries to characterize what makes a palette ordering feel "pleasing" when the same set of colors is arranged in sequence.

The report argues that successful orderings are usually a compromise between:

- a mostly smooth walk through color space
- a small number of deliberate discontinuities, often one dominant seam

## Main Failure Modes

According to the report, bad orders tend to show up as:

- repeated big jumps instead of one intentional seam
- alternating neutrals and vivid colors too often
- scattering nearby colors far apart in the sequence
- excessive hue hopping
- too much back-and-forth in lightness

## Metrics Used

The report focuses on several signals:

- **spike ratio** - whether one jump dominates or many large jumps compete
- **kNN scatter** - whether similar colors stay near one another
- **neutral-boundary rate** - how often greys and chromatic colors alternate
- **cluster fragmentation** - whether similar groups get broken apart
- **max edge mass** - how much of the total discontinuity is concentrated in one seam

## Why It Matters

- Useful for anyone building **palette-sorting or palette-display tools**
- Shows that pleasing order is not identical to simple hue sort or lightness sort
- Reinforces a broader theme in this repo: good color systems often balance **smooth structure with one or two deliberate disruptions**

## Practical Takeaways

- Avoid palette orders with many equally large jumps.
- Keep similar colors locally coherent unless you have a clear reason to separate them.
- Treat neutrals as a structural group, not as accents to alternate blindly between saturated colors.
