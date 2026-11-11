# PerpLab UI guidance

## Context and goals

PerpLab must make a perpetual futures trade understandable in one pass: select a market, preview the cost, place a paper order, and see what closed it. The audience is students and reviewers. This project adapts the supplied documentation tokens to a trading terminal and a short Guide.

## Design tokens and foundations

The source of truth is `client/styles.css`. Components must use semantic CSS tokens. Shared values should be changed there so Trade, Portfolio, and Guide stay consistent.

| Use | Tokens and values |
| --- | --- |
| Type | `--font-family`: Poppins, Poppins Fallback, UI sans, system UI, sans; base 16 px / 24 px / 400. The size scale is 11, 12, 13, 14, 15, 16, and 20 px. |
| Text | `--text-primary` for content, `--text-secondary` for supporting text, `--text-tertiary` and `--text-inverse` for translucent light text on dark surfaces. `--action-text` must be used on the light action fill. |
| Surfaces | `--surface-base` for the page, `--surface-muted` for panels and the chart, `--surface-raised` for nested surfaces, and `--surface-strong` for the translucent navigation surface. |
| Boundaries | `--border-strong` for structural dividers; `--border-control` must identify controls where the boundary is necessary. `--focus-ring` must remain visible on both dark and light controls. |
| Feedback | `--text-positive`, `--text-negative`, and `--text-warning` must appear with words, signed values, or icons that convey the same meaning. |
| Spacing | Components must use `--space-1` through `--space-8`: 6, 8, 10, 12, 16, 20, 24, and 32 px. Touch targets must use the shared sizes derived from the scale. |
| Shape and motion | Components must use `--radius-xs` (8 px) for controls, `--radius-sm` (12 px) for panels, and `--radius-pill` for tags. Inputs should reuse `--shadow-1`; raised actions and dialogs should reuse `--shadow-2`. Transitions must use 120 or 150 ms. |

## Component rules

The reference extraction counted 23 buttons, 13 links, 4 navigation regions, 2 inputs, and 1 card. Those counts describe the reference's density; the app must show only the actions available in the current view.

| Component | Anatomy and input | States and edge cases |
| --- | --- | --- |
| Button | An action label and optional decorative icon. Buttons must activate by Enter, Space, click, or tap; primary actions use the accent fill. | Default, hover, focus-visible, and pressed must be distinct. Disabled controls must expose their native state. Loading must show a named progress action and prevent repeat submissions. Errors must stay by the action so the user can retry. |
| Navigation | One labeled landmark with Trade, Portfolio, and Guide links. Links must work by Tab and Enter, click, and tap. | Default links are quiet; hover and focus make them clear; active shows an underline and `aria-current`. Routes remain available while data loads or errors. No disabled route is required. The nav must wrap below the brand on small screens. |
| Market and chart | A labeled native pair selector, quote stats, time-range buttons, a TradingView Lightweight Charts candle plot, and a keyboard-accessible Price data disclosure. | Range buttons must expose the selected state. The selector and disclosure must have hover, focus, and pressed feedback. History loading and errors must leave a retry path. A stale or absent quote must be labeled and must disable order submission. The chart must allow horizontal touch drag without trapping vertical page scroll. |
| Order form | Direction and leverage radios, quantity, optional stop-loss, order preview, and one submit action. Radio groups must support arrow keys; inputs must have visible labels and usable touch targets. | Default fields stay editable. Hover, focus, and selected states must remain distinct; pending submission disables fields. Field errors must name the problem and stay near the form. The order summary must show dashes when values are unknown. The panel must stack under the chart on narrow screens. |
| Positions and history | A named list of positions, each with an explicit close button, and a history table with a labeled filter. | Empty, disconnected, and no-match states must explain the next step. Read-only values have no active or disabled state. Close and filter controls must show hover, focus-visible, pressed, disabled, and applicable pending/error states. Long position lists and wide tables must scroll within their own labeled regions. |
| Wallet, close, and demo dialogs | A heading, a description, an explicit close button, and actions with descriptive names. | Native modal focus must stay inside; Escape and the close button dismiss when idle. Pending actions must disable duplicate submissions. An error must be announced and leave recovery controls visible. Long addresses and messages must wrap. |

## Accessibility acceptance criteria

- At 320 CSS px and at 200% zoom, page content must fit without horizontal page scroll. A wide data table may scroll within its labeled region.
- Text must meet 4.5:1 contrast against its background; focus indicators and required control boundaries must meet 3:1 against adjacent colors.
- Tab must expose a visible skip link and a visible focus ring on every enabled control. The keyboard must reach chart ranges, the price data table, the order form, the close action, and the history filter.
- The dialog must trap Tab while open and return focus to the initiating control when it still exists. Escape must dismiss it while idle.
- Every enabled target must be at least 24 × 24 CSS px or meet the WCAG spacing exception. Primary actions should be 44 px high.
- A screen reader must read the input name, a validation error, and the outcome of a submission. Price ticks must not be announced on every update.
- Direction, exit reason, and profit or loss must remain understandable in grayscale. With reduced motion enabled, the UI must suppress nonessential motion.

## Content and tone

Labels must name the action or data. Use “Open long,” “Apply practice price,” and “Realized P&L.” Errors should give the reason and a recovery action: “Insufficient available margin. Reduce the quantity or close a position.” Empty states should show what belongs there: “Orders and position exits will appear here.”

## Anti-patterns

Components must not hard-code palette values, hide focus, label practice data as live market data, convey risk with color alone, or show a fake fill before the backend accepts an order. New controls should reuse the existing button, panel, and field styles.

## QA checklist

- [ ] Switch SOL, BTC, and ETH and verify that the chart and form match.
- [ ] Tab through the dashboard, open a dialog, and dismiss it with Escape.
- [ ] Try a valid long, an invalid stop, a manual close, and an automatic exit.
- [ ] Verify loading, delayed data, empty history, and signed-out states.
- [ ] Check desktop, mobile, 200% zoom, focus contrast, and reduced motion.
