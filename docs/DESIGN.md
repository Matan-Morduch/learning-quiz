# Design guide (all apps)

One design for every app: the Learning Quiz, LifeOS and anything new. It follows Apple's Human Interface Guidelines, on the web.

- **Source of truth:** `Learning/_quiz/ui/base.css`. Tokens and shared controls live there and nowhere else.
- **Other apps** keep a byte-identical copy. LifeOS has it as `public/design.css`, synced by `LifeOS/deploy/sync-design.sh` (`--check` fails if the copy has drifted).
- **Icons:** `ui/icons.js` (quiz). LifeOS uses the same set plus app icons in `public/icons.js`.

## Principles

1. **Clarity.** Legible type, plain words, one primary action per screen.
2. **Deference.** Content comes first. Chrome (sidebar, toolbar, tab bar) sits on translucent materials and stays quiet.
3. **Depth.** The layers are window, then content (cards, grouped lists), then floating panels (popovers, inspectors), then sheets and alerts. Each layer up gets more shadow and a scrim when it's modal.
4. **System, not custom.** Use system colours, the system font (SF), and the controls below. Don't invent a new button or colour per page.

## Tokens (base.css)

| Kind | Tokens | Notes |
|---|---|---|
| Font | `--font` (SF Pro), `--font-rounded` (numbers in big stats), `--font-mono` | Never set a font family by hand |
| Type scale | `--large-title` 34 · `--title1` 28 · `--title2` 22 · `--title3` 20 · `--headline` 17 semibold · `--body` 17 · `--callout` 16 · `--subhead` 15 · `--footnote` 13 · `--caption` 12 | Use as `font: var(--headline)`. Classes `.large-title`, `.title1` … `.caption` do the same |
| Backgrounds | `--window` (page), `--surface` (cards, lists, sheets), `--surface-2` (fields, insets), `--surface-3` | Grouped style: grey window, white cards |
| Labels | `--label`, `--label-2` (secondary), `--label-3` (placeholder), `--label-4` (disabled) | Secondary text is `--label-2`, not opacity |
| Fills, lines | `--fill`, `--fill-hover`, `--separator`, `--separator-strong` | Hairlines are `--separator`, 1px |
| Colours | `--blue --green --orange --red --yellow --purple --pink --teal --indigo --mint --brown`; `--accent`, `--accent-tint`, `--on-accent` | Meaning: green = good, orange = warning, red = bad or destructive. Light and dark values are built in |
| Materials | `--material`, `--material-thick`, `--sidebar`, `--blur` | For chrome and floating panels only |
| Depth | `--shadow-1` (cards), `--shadow-2` (floating), `--shadow-3` (sheets, alerts, toasts) | |
| Shape | `--r-xs` 6 · `--r-sm` 8 · `--r` 10 · `--r-lg` 14 (cards) · `--r-xl` 20 (sheets) · `--r-pill` | |
| Space | `--sp1` … `--sp16` (4pt grid) | |
| Sizes | `--control-h` 32 (pointer), `--control-h-lg` 44 (touch), `--sidebar-w` 260, `--read-w` 720, `--toolbar-h` 52 | |
| Motion | `--ease`, `--spring`, `--dur` | Reduced-motion is respected automatically |

Older names (`--bg --card --text --muted --border --accent --good --code` …) are aliases, so old CSS keeps working. New CSS uses the real names.

## Components: which class to use

| Need | Use | Not |
|---|---|---|
| Main action | `.btn.btn-primary` (or `<button class="primary">`) | A coloured link |
| Secondary action | `.btn` (grey fill) or `.btn-tinted` | Bordered outline buttons |
| Text-only action | `.btn-plain` | |
| Delete | `.btn-destructive`; the confirming button of a destructive alert is `.btn-danger` | |
| Size | `.btn-sm` (28) · default (32) · `.btn-lg` (44) · `.btn-block` | |
| Icon-only button | `.icon-btn` + an SVG icon, always with `aria-label` and `title` | Emoji or ☰ / ⚙︎ glyphs |
| Text field | `.field` (`input`, `textarea`, `select`) | Bordered boxes on white |
| Switch between 2–5 views | `.segmented` (LifeOS: `.tabs`) | Underlined tabs |
| On/off setting | `input.switch` | A checkbox for a setting |
| Multi-select | `input.check`, or `.multiselect` for long lists | |
| Card | `.card` / `.card-surface` | Borders around cards |
| List of rows | `.list` > `.list-row` (with `.list-header`, `.list-footer`, `.chevron`, `.detail`) | Tables for non-tabular things |
| Section header | `.section-label` (13 semibold, secondary, sentence case) | UPPERCASE tracked headers |
| Status / count | `.badge` (`.accent .green .orange .red`) | |
| Subject / category | `.tag` with `--tag: var(--tint-N)` | |
| Progress | `.progress > span` | |
| Menu or filters anchored to a button | `.popover` | |
| Inspector / side panel (wide screens) | `.sheet` | |
| Confirm a destructive step | `.scrim > .alert` | `window.confirm()` |
| Waiting | `.activity` / `.spinner` | |
| Feedback after an action | toast (HUD on `--material-thick`) | `alert()` |

Writing: sentence case everywhere (titles, buttons, headers). Buttons say what they do ("Save recipe", not "OK"). No emoji in chrome or titles; content may use them.

## Desktop and iPhone

| | Mac / wide window (> 900px) | Medium (701–900px) | iPhone (≤ 700px) |
|---|---|---|---|
| Navigation | Left sidebar on `--sidebar` material: app/section list with SVG icons, the current one tinted (`--accent-tint`, semibold) | Sidebar becomes a slide-over behind the toolbar's sidebar button | Bottom tab bar (`.tabbar`): up to 4 destinations + More, SVG icons, `--material-thick`, labels 10.5px |
| Hide the sidebar | Sidebar button or ⌃⌘S → a toolbar with a show-sidebar button (remembered) | Scrim tap or Esc closes | — |
| Page title | Title 1 (28) on the left, actions on the right | Same | Large title (34 bold) on its own line, actions under it |
| Modal content | Centred panel (`dialog`, `.alert`) or a right-hand `.sheet` | Same | **Bottom sheet**: slides up, grabber, full width, rounded top corners, dims the page; tapping the dim closes it |
| Menus | `.popover` anchored to its button | Same | Bottom sheet with `.list-row`s (e.g. "More") |
| Hit targets | Pointer sizes: controls 28–32px | Same | 44pt minimum on touch (`pointer: coarse`); segmented controls 32 |
| Body text | 17 (`--body`); dense data 15 (`--subhead`) | Same | 17; inputs at least 16px or iOS zooms on focus |
| Hover | Hover states, keyboard hints (`kbd`) | Same | No hover-only UI: actions that appear on hover must always show on touch |
| Gestures | Click, keyboard shortcuts | | Tap, swipe sideways inside wide tables, tap the dim to dismiss |
| Safe areas | — | Toolbar pads for `env(safe-area-inset-*)` | Content clears the notch and home bar; the tab bar pads the home indicator; a material strip sits under the status bar |
| Keyboard | — | — | Tab bar hides while typing (`body.kb-open`) |
| Wide tables | Fit the card | Scroll inside the card | Scroll inside the card; only the wordiest column wraps |
| Toasts | Bottom centre | Same | Just above the tab bar |

## Icons

24×24 grid, 1.7 stroke, round caps and joins, `stroke="currentColor"`, no fill: SF Symbols in spirit. Get one with `Quiz.icon('name')` (quiz) or `icon('name')` (LifeOS). Size it with CSS (16 in buttons, 18–19 in the sidebar, 24 in the tab bar). In chrome (navigation, toolbars, buttons), always use an SVG icon, never an emoji. To add an icon, draw it on the same grid and add it to `ui/icons.js`, then copy it to the other apps' icon files.

## Dark mode and preferences

Dark mode is automatic: every token has a dark value, so never hard-code a colour. If you need a new colour, mix it from tokens (`color-mix(in srgb, var(--green) 16%, transparent)`). `<html data-theme="light|dark">` forces a theme, `data-accent` changes the accent, and `data-text` / `data-density` scale text and spacing. Put `<meta name="color-scheme" content="light dark">` and theme-color metas `#f5f5f7` (light) and `#000000` (dark) in every page.

## How to add a new app

1. Load the design system first, then the app's own CSS:
   `<link rel="stylesheet" href="/design.css">` (a copy of `ui/base.css`) → app CSS.
2. **Inside LifeOS:** add the page as `public/<id>.html` and load `/design.css`, `/style.css`, `/icons.js` in the head and `/common.js` at the end of `<body>`. That gives you the sidebar, tab bar, More sheet, dialog-as-sheet, toasts and table scrolling for free. Add the app to `APPS_NAV` in `common.js`, either as a tab (at most 4) or under More.
3. **Standalone app:** copy `ui/base.css` and `ui/icons.js`. Copy the shell (`.app`, `.side`, `.toolbar`, `.tabbar` rules) from the quiz's `index.html`, and add your copy to the sync script.
4. Page structure: `.wrap` > `header` (h1 and actions) > cards or grouped lists. Section headers use the section-label style.
5. Check it at 1440 and 390×844, light and dark. Nothing should scroll sideways on the phone, hit targets should be 44pt on touch, and no colour should be hard-coded.
