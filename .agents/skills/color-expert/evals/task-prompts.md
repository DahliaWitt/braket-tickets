# Task Prompts

Use these prompts for qualitative review of the skill. They are meant to test whether the skill gives the right kind of answer, not whether it produces one rigid output.

## What to look for

- Does the answer pick the right conceptual frame quickly?
- Does it distinguish standards, heuristics, and implementation reality?
- Does it avoid shallow wheel-theory advice when a stronger explanation exists?
- Does it recommend tools and references that fit the actual task?
- Does it stay concise unless the task really needs deeper theory?

## Prompts

### 1. UI ramps and accessibility

"I need a semantic color system for a data-heavy app. We want success, warning, danger, info, and neutral scales with light and dark themes. Please recommend a practical color-space workflow, how to keep the ramps perceptually even, and how to think about accessible foreground colors."

Good answer:

- pushes toward OKLCH or a similarly defensible working space
- distinguishes palette tokens from semantic tokens
- treats contrast as something to verify, not eyeball
- avoids pretending hue harmony alone solves readability

### 2. Print versus screen mismatch

"My mockup looks bright and clean on my MacBook, but the printed brochure feels dull and slightly warmer. Can you explain why this happens and what workflow would reduce the surprise next time?"

Good answer:

- explains gamut, viewing conditions, and print/screen differences cleanly
- mentions ICC, D50 or D65 context where useful
- does not oversimplify to 'printers use CMYK so colors are worse'

### 3. Paint mixing in software

"I'm making a digital painting tool and artists keep complaining that mixing yellow and blue looks wrong. What model should I look at if I want mixing to feel more like paint than Photoshop opacity?"

Good answer:

- rejects naive RGB interpolation for pigment mixing
- points toward Kubelka-Munk, Spectral.js, or Mixbox-style approaches
- explains why pigment mixing paths differ from light mixing

### 4. Naming and historical register

"Can you suggest names for 12 muted naturalist-style colors for a field guide interface? I want something closer to Ridgway or ISCC-NBS than startup branding names."

Good answer:

- recognizes the naming-system question immediately
- mentions appropriate systems such as Ridgway, ISCC-NBS, or Munsell depending on the need
- avoids random poetic names unless the user asked for them

### 5. Harmony advice under pressure

"My teammate keeps insisting we should use a triadic palette because that's 'good color theory'. I need a better argument for choosing a calmer, more legible palette for a dashboard."

Good answer:

- de-centers hue-first harmony rules
- emphasizes lightness, chroma, character, and task-specific legibility
- gives a usable alternative rather than only criticizing triads

### 6. CSS color support question

"Can I rely on `contrast-color()` and `device-cmyk()` in production CSS today, or are those still more spec than reality?"

Good answer:

- distinguishes specification from shipped browser support
- uses the CSS Color references without overclaiming implementation status
- stays grounded in practical deployment advice

### 7. Perceptual terminology

"Please explain brightness, lightness, saturation, chroma, and colorfulness without sounding like a textbook. I need to paste it into internal design docs."

Good answer:

- uses plain English without collapsing the terms into synonyms
- stays accurate enough to support later technical work
- does not drift into hand-wavy 'vibes' language

### 8. Image compression and vision

"Why does JPEG throw away so much color information before people notice? I want the answer in a way frontend devs will actually remember."

Good answer:

- connects YCbCr and chroma subsampling to human vision clearly
- avoids explaining compression as if color simply matters less than brightness in every context
- keeps the explanation practical and memorable
