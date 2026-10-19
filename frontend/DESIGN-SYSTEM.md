# CareSphere design system

One set of tokens drives every page (public, donor, staff and admin).

| File | What it holds |
|---|---|
| `src/styles/tokens.css` | Colour channels (`--cs-*`) for **light** (default), **dark** (`[data-theme="dark"]`) and **high contrast** (`.cs-contrast`, works with either), plus named aliases (`--color-page`, `--color-primary`, `--radius-card`, `--spacing-4`, `--content-max-width` ...). |
| `src/theme/palette.js` | Maps the Tailwind colour names already used in the pages (`navy-900`, `brand`, `slate-500`, `bg-white`, status colours) to those tokens, so class names did not change. |
| `tailwind.config.js` | Imports the palette; shadows, 3px focus ring (`ring-2`), fonts, animations. |
| `src/index.css` | Base styles, `.input`, tables, phone table stacking, motion, display-setting classes. |
| `src/pages/home.css` | Public pages: shared centred container (`.public-container`), header, footer, hero and section layout. |
| `src/pages/adoption/adoption.css` | Donor adoption pages (`.cs-theme`); local `--ad-*` names are aliases of the shared tokens. |
| `src/components/ui.jsx` | Shared components: Button (primary, outline/secondary, ghost, danger, dark; loading), Card, PageHeader, WelcomeBanner, Badge, Alert, Modal, Tabs/chips, EmptyState, Skeleton, StatTile, IconButton. |
| `src/hooks/useThemeColors.js` | Token colours for charts and SVGs that CSS classes can't reach. |

## Light theme (WCAG AA measured)

| Token | Value | Use |
|---|---|---|
| page | #F2F7FF | page background |
| panel | #E3EFFE | header bands, soft panels, footer |
| surface | #FFFFFF | cards, inputs, sidebar, top bar |
| border | #D3E2F7 | decorative card edges (not used alone for controls) |
| control | #7D8FB3 | form-field outline, 3.25:1 on white (substitute for #D3E2F7, which is 1.3:1) |
| heading | #0B2A66 | headings and main text |
| text | #1F2A44 | body text |
| muted | #51607F | secondary text, 5.9:1 on page |
| primary | #1B5FD1 / hover #164EAF / active #123F91 | buttons, active nav, links (5.8:1 on white) |
| success | #0B6B3A on #DDF4E8 · warning #8A4B00 on #FFF1D6 · danger #A12020 on #FDE5E5 | status |

Radius: cards 16px, controls 12px, pills 999px. Shadow: `0 2px 8px rgba(27,95,209,.07)`. Focus: 3px (4px in high contrast).

## Display settings (accessibility button in every header)
Text size · Theme (Light / Dark / Device) · Sidebar (Light / Navy, signed-in pages) · Reduce motion · High contrast · Underline links · Easy-read spacing. Stored per browser; presentation only.
