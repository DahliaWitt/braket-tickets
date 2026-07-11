# Brand & Design Rules

Authoritative, enforceable design rules for Braket Tickets UI. Cite this file in
UI reviews. Every rule is a hard check: a PR that violates one needs an explicit,
documented reason or it gets changed. Tokens referenced here are defined in
`frontend/src/styles.css` — do not invent token names.

The aesthetic: **event-flyer energy, stage lighting not neon.** Dense, confident,
typographic. Not a SaaS dashboard.

## Voice & copy

- **Lowercase UI copy.** Headings, labels, buttons, toasts, empty states are lowercase — it is the brand voice. No Title Case. _Rationale: flyer/zine energy; Title Case reads corporate._
- **No exclamation-mark enthusiasm.** _Rationale: terse and cool, never peppy._
- **Never "successfully."** Say what happened, lowercase, no trailing period on toasts (`ticket sent`, not `Ticket sent successfully!`). _Rationale: filler word; the action already implies success._
- **No corporate filler.** Ban "welcome back", "get started", "oops", "we're sorry". _Rationale: generic SaaS voice dilutes the brand._
- **No emoji-as-icons.** Use the icon set, not emoji. _Rationale: emoji render inconsistently and read as amateur._
- **No underscores in visible copy** and **no `//` label prefixes.** _Rationale: code artifacts leaking into UI._

## Typography

- **Headings use Syne** via `font-display`, **max weight 800** — never `font-black`/900. _Rationale: 900 is heavier than the display face is drawn for; it smears._
- **Body uses Inter** (`font-sans`, the default). _Rationale: readable body contrast to the display face._
- **Labels/data use Space Mono** (`font-mono`), **uppercase + `tracking-widest`.** Prefer the `.mono-label` utility (sets font-mono + uppercase + tracking) over re-typing the classes. _Rationale: mono labels are the repo's signature; the utility keeps 60+ usages consistent._
- **Standard page `h1`:** `text-2xl sm:text-3xl lg:text-4xl font-bold font-display tracking-tight`. _Rationale: one heading scale across pages._
- **`text-2xs` = 10px** (`--text-2xs`) is the micro-label token. Do not hardcode a smaller size. _Rationale: single source for the smallest legible label._

## Color & tokens

- **Semantic tokens only.** Use `bg-background`, `text-foreground`, `text-muted-foreground`, and the `primary` / `secondary` / `accent` / `destructive` / `success` / `warning` / `info` families. Every family has a `-foreground` variant (text on the solid token used as a fill). Only `secondary`, `destructive`, and `info` also have a self-tinted `-text` variant; `warning` and `success` have none — their base token is already AA on its own tint. _Rationale: theming + dark mode + AA calibration all live in the tokens._
- **Never raw Tailwind palette classes** (`amber-*`, `gray-*`, `zinc-*`, `plum-*`, …) or hardcoded hex/oklch in templates. _Rationale: palette classes bypass the theme and break dark mode._
- **On self-tinted surfaces** (e.g. `bg-secondary/10`, `bg-destructive/10`, `bg-info/10`) use the AA-calibrated **`-text` variant** for the foreground — the only three that exist: `text-secondary-text`, `text-destructive-text`, `text-info-text`. For `bg-warning/10` and `bg-success/10` there is no `-text` variant; pair the tint with the plain base token (`text-warning`, `text-success`), which is calibrated to pass AA on its own tint. _Rationale: `secondary`/`destructive`/`info` base tokens fail AA over their own tint and get a darker `-text` variant; `warning`/`success` base tokens are already tuned for it, so a `-text` class would be a silent Tailwind no-op._
- **Never alpha-modify a calibrated text token** (no `text-warning/70`) and **never put `opacity-*` on a text-bearing element.** _Rationale: it silently drops the text below the AA ratio the token was tuned for._
- **Palette identity:** deep plum/wine primary, violet secondary, burnt amber accent — "stage lighting, not neon." _Rationale: moody and saturated, never candy-bright._

## Radius & spacing

- **Default `--radius` is 4px** (`0.25rem`). Mixed radius across a composition is **intentional**. _Rationale: sharp default reads editorial._
- **Uniform `rounded-xl` / `rounded-2xl` everywhere is an anti-pattern.** _Rationale: uniform pill-rounding is the generic SaaS look this brand rejects._
- **Base spacing unit is 16px (`gap-4`); 24px (`gap-6`) for section breaks.** Denser than a typical SaaS layout. _Rationale: information density is a brand trait._

## Effects & imagery

- **No gradient text** (`bg-clip-text` on text). _Rationale: cheap, illegible, off-brand._
- **No glow/blur floating-card heroes and no inline glow shadows** (`shadow-[0_0_...]` in templates). _Rationale: floating glowing cards are the generic-AI-landing look._
- **The only sanctioned emphasis effect is the `zGlow` button variant** (`frontend/src/app/ui/components/primitives/button`). If you want glow, use that input — do not hand-roll a shadow. _Rationale: one owned, tuned treatment instead of ad-hoc shadows._
- **No glitch effects, no fire imagery.** _Rationale: explicit brand exclusions._
- **Photography over stock/AI illustration.** _Rationale: real event photography carries the brand; stock illustration cheapens it._
- **Boxy grids use gap + background tint, not borders.** Separate cards with `gap-*` and a `bg-muted`/`bg-card` tint, not border-heavy outlines. _Rationale: borders everywhere read busy; tint + gap reads intentional._

## Accessibility

- **WCAG 2.2 AA** is the floor for contrast and interaction. _Rationale: legal + brand baseline._
- **Minimum 24px touch targets.** _Rationale: WCAG 2.2 target-size; usable on mobile._
- **Visible focus states** on every interactive element (the global `:focus-visible` ring). Do not remove outlines. _Rationale: keyboard operability._
- **Icon-only controls need `aria-label`.** _Rationale: screen readers have no text otherwise._
- **Every data-driven surface ships three states:** explicit **loading** (skeleton), **empty** (branded empty-state), and **error** (branded error UI). _Rationale: a bare spinner-or-nothing surface is unfinished._
- **Mutation buttons need pending/disabled guards.** Disable while a mutation is in flight. _Rationale: prevents double-submits in the zoneless double-click race._
