# Color Names Across Languages

**Source:** EuroVis 2019
**Authors:** Younghoon Kim, Kyle Thayer, Gabriella Silva Gorsky, Jeffrey Heer
**URL:** https://idl.uw.edu/color-naming-in-different-languages/
**Data:** https://github.com/uwdata/color-naming-in-different-languages
**License:** Open data on GitHub

## Problem

Different languages divide the color spectrum in fundamentally different ways, but most digital color tools assume English categories. Translating color terms between languages is inherently lossy because category boundaries don't align.

## Methodology

- ~15-minute survey on LabIntheWild (online crowdsourced experiment platform)
- Two tasks: free-form color naming (no hints) and color-name matching (does this name fit this swatch? yes/no/somewhat/don't know)
- Additional color sorting task (90 tiles, identical shuffled starting states for comparability)
- Colors presented as perceptually uniform sets, hue discretized into 36 equally-spaced bins
- Color spaces: sRGB, Display P3, Rec. 2020
- Analysis: Self-Organizing Maps (SOMs) for 2D term-distribution visualization, conditional probabilities P(Color | Name), LAB-distance binning, cross-language translation loss metrics

## Scale

- 79 languages in dataset
- English dominates: ~49K hue-line entries, ~148K full-color entries, 314+ distinct hue terms
- Strong data for Korean (13.5K), Chinese (6.3K), Spanish (4.1K), German (3.8K), Persian (3K), French (2.9K), Russian (1.7K), Portuguese (1.6K), Dutch (1.4K), Polish (1.2K)
- Many more languages with hundreds of entries but limited full-color-space coverage

## Key Findings

### Universal vs. language-specific boundaries

Some color boundaries are near-universal (e.g., red/orange). Others are highly language-specific. Russian requires distinct terms for light blue ("goluboy") and dark blue ("siniy") — these aren't shades of one category but separate basic color terms. Korean has a similar mandatory blue split.

### Term granularity varies enormously

English speakers use 314+ distinct hue terms; some languages use fewer than 10 basic terms. This is not just vocabulary size — it reflects genuinely different perceptual categorization strategies.

### Translation is lossy

Mapping color terms between languages necessarily loses information. The paper quantifies this with a translation loss metric. Example: Korean's two blues collapse into one English "blue," losing the light/dark distinction. English's "teal" and "turquoise" may collapse into a single term in other languages.

### Salient colors differ by language

The most prototypical or "best example" color for a given category shifts between languages. The "best red" for a Korean speaker is not the same sRGB value as the "best red" for an English speaker.

## Interactive Visualizations

The project site provides 8 tools:

1. Color Name Summaries — overview of term distributions per language
2. Color Translator — cross-language term lookup
3. Hue Color Comparisons — brightest, most saturated colors per term
4. Full Color Comparisons — complete color space coverage
5. Korean-English Translation Comparison — detailed case study
6. Korean-English Viridis Spectrum — how each language segments a perceptual ramp
7. Full Color Bin Options — binning parameter exploration
8. Color Name Data Entries — raw data browser

## Why This Matters

- **Color naming tools** should not assume English categories are universal. Any naming API or color dictionary benefits from multilingual awareness.
- **Palette communication** across cultures is harder than it looks — "blue" is not one thing.
- **Accessibility** has a linguistic dimension: if a UI relies on color names for communication, the names must match the user's language categories, not just be translated literally.
- **Perceptual uniformity** alone doesn't solve naming — two colors equidistant in OKLAB may fall in the same category in one language and different categories in another.
- Provides empirical data for the Sapir-Whorf hypothesis applied to color: language doesn't just label perception, it shapes categorization.

## Citation

If you use the data in published research, please cite:

> Kim, Y., Thayer, K., Gorsky, G.S., & Heer, J. (2019). Color Names Across Languages: Salient Colors and Term Translation in Multilingual Color Naming Models. *EuroVis*.
