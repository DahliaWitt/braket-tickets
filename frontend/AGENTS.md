# Frontend Rules

Applies to everything under `/frontend`.

## Angular

- Keep Angular v22 zoneless patterns: signals/computed for state, `resource()` for async loading
- Do not add `zone.js`, `FormGroup`, `FormControl`, or `ReactiveFormsModule` for new work
- Verify unfamiliar Angular APIs with Angular MCP or docs before changing patterns

## Component Naming & Prefixes

- **`z-` prefix**: Reserved for components derived from ZardUI (`ng add`). These are copy-paste
  owned code (ShadCN-style) — modify freely, but the prefix signals ZardUI lineage.
  Examples: `z-card`, `z-button`, `z-input`, `z-alert`, `z-switch`, `z-tabs`
- **`bra-` prefix**: For Braket-native shared library components built from scratch, not derived
  from ZardUI. Lives in `ui/components/`. Examples: `bra-status-badge`, `bra-page-header`
- **No prefix**: Feature-level and page-level components do NOT get a prefix. Components under
  `features/` and `pages/` are scoped to their feature — prefixes are only for the shared
  component library (`ui/components/`).
- **Never prefix non-ZardUI components with `z-` or `Zard`**. If it wasn't pulled from ZardUI,
  it does not get the `z-` prefix. This has been a recurring mistake.
- Existing `z-`/`Zard`-prefixed shared components that are NOT ZardUI-derived should be renamed
  to `bra-` when next touched (not as a standalone chore — do it when modifying the file).

## Creating New Shared Components

Before building any new shared/UI component from scratch, **check ZardUI first**
(use context7 MCP or https://zardui.com/). If ZardUI has a matching primitive:

1. Pull it via `ng add` or copy the source
2. Prefix with `z-` (it's ZardUI-derived)
3. Customize variants, styling, and behavior to meet Braket's needs

Only use `bra-` prefix and build from scratch when ZardUI has no equivalent or when
the component is inherently brand-specific (e.g., `bra-status-badge` with Pulp
semantic color mapping, `bra-page-header` with back-nav pattern).

## New Component Requirements

All new components (both `z-` and `bra-`) must:

- Use Angular signals for state (no zone.js, no RxJS BehaviorSubject for component state)
- Include a CDK test harness (`ComponentHarness` subclass) alongside the component
- Meet WCAG 2.1 AA accessibility: proper ARIA roles, keyboard navigation, focus management,
  color contrast ratios. Use `role`, `aria-label`, `aria-describedby`, etc. as appropriate.
- Use CVA (class-variance-authority) for variant styling where the component has multiple visual states
- Support the Pulp theme tokens — never hardcode colors; use semantic tokens (`--primary`,
  `--success`, `--warning`, `--destructive`, etc.)

## Testing

- Use CDK Harnesses for frontend tests
- Do not use `nativeElement.querySelector`, `fixture.nativeElement`, or ad-hoc DOM selectors in specs
- If a component/page lacks a harness, add one alongside the component before adding behavior tests
- Prefer `TestbedHarnessEnvironment` plus focused harness methods over asserting raw DOM structure
- One harness file per component. New harnesses use the `<name>.component.harness.ts` filename. Before adding a harness, check for an existing one in the same directory and extend it instead of creating a sibling — even if the existing file uses the older `<name>.harness.ts` naming.

## Shared Components

- New shared UI components must include a Storybook story (`.stories.ts`) alongside the component
- ZardUI-derived components use the `z-` prefix (pulled from ZardUI, customized for Pulp)
- Braket-native components use the `bra-` prefix (built from scratch for this project)
- `primitives/` = simple atoms (both z- and bra- prefixes live here)
- `composites/` = complex multi-part components (both z- and bra- prefixes live here)
