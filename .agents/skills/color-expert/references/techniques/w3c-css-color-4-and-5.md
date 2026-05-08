# W3C CSS Color 4 and 5

**Specs:**

- CSS Color 4 — [w3.org/TR/css-color-4](https://www.w3.org/TR/css-color-4/)
- CSS Color 5 — [w3.org/TR/css-color-5](https://www.w3.org/TR/css-color-5/)

## What It Is

The canonical standards for **modern color in CSS**. If a task touches browser color syntax, interpolation, wide gamut, or CSS-native color computation, these specs are more authoritative than blog posts or library docs.

They describe the **standard**, not guaranteed shipped support in every browser. For compatibility questions, treat the specs as the normative definition and check current implementation status separately.

## CSS Color 4 — Key Additions

- **`lab()` / `lch()`** and **`oklab()` / `oklch()`** in CSS
- **`color()`** for predefined spaces like `display-p3`, `a98-rgb`, `prophoto-rgb`, `rec2020`, `xyz-d50`, `xyz-d65`
- Defined **interpolation spaces** and **gamut mapping** behavior
- Sample conversion code, including **D65↔D50 Bradford adaptation** and **ΔE2000**

## CSS Color 5 — Key Additions

- **`color-mix()`**
- **relative color syntax**
- **`light-dark()`**
- **`contrast-color()`**
- **`@color-profile`** for ICC-backed custom spaces
- **`device-cmyk()`** for uncalibrated CMYK, plus calibrated CMYK workflows via ICC profiles

## Why This Matters for the Skill

- This is the correct source for browser-facing advice on **OKLCH**, **wide-gamut CSS**, and **mixing in Oklab/Oklch**.
- Useful for distinguishing what is **standardized**, what is **browser-specific**, and what is just a library convention.
- Bridges design-system tasks with real color science: **D50/D65 adaptation**, **gamut mapping**, and **profiled color spaces** are all first-class topics here.

## Practical Use

- Use for any **web or design-system** question involving color syntax.
- Use when recommending **CSS-native palette generation** or **relative color transformations**.
- Use when a user asks what a feature **means** or how it is **supposed** to behave in CSS.
- If a user asks whether a workflow is **currently shipped**, pair this reference with up-to-date browser compatibility data rather than inferring support from the spec alone.
