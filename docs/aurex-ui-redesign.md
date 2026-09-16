# AUREX premium Mini App redesign

This is a presentation-only iteration. `public/app/index.html` defines the screen structure, `premium.css` provides the shared visual language, and `premium.js` supplies progressive enhancements. Existing Telegram initialization, authenticated API requests, slip state, code creation, screenshot reading, and X reading remain in `app.js` and `miniapp-controls.js`.

## Screens

- **Build:** clear hierarchy, sport selector, 3/5/7/10/custom game counts, decimal target odds and risk cards. Retains live fixture discovery and AI analysis.
- **Analyze:** active-slip evidence overview and per-selection cards with the actual data available; read-code, public X-post and screenshot tools remain below.
- **My slip:** aggregate odds, clearly labeled evidence score, compact selection cards, removal and booking action.
- **Booking confirmation:** an enhanced non-staking share-code result with copy and share actions.

Evidence-quality scores are not calibrated winning probabilities. Avoid invented news, detailed rationale or false live-game claims. The screen explicitly displays an unavailable-reason message when per-selection rationale is not present in the API payload.

## Release verification

GitHub Actions: install dependencies, generate Prisma client, TypeScript, ESLint, Vitest and production build. Then visually test in Telegram on iOS and Android at narrow widths; verify presets, custom number, decimal odds, risk cards, build, removal, analysis, X, screenshot, code read and code creation. Check keyboard overlap, safe-area bottom navigation, copy/share and stale local slips. The normal CI tests do not constitute a device-level visual or live bookmaker test.

Merge to `main` only after CI passes; Vercel will deploy the merged commit automatically if Git production integration remains configured. No wager placement or staking workflow is added.
