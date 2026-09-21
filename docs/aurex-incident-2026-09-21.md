# AUREX production incident — 21 September 2026

Confirmed against Vercel production runtime logs:

- Telegram webhook registration fails: the production token identifies `@slippilotbot`, while the code expects `@AurexIQBot`. Verify the intended bot in BotFather and set the matching `TELEGRAM_BOT_TOKEN` in Vercel Production; never paste the token into issues, commits or chat. Redeploy and verify `getWebhookInfo` and an actual `/start` message. Telegram cannot programmatically auto-open a Mini App from `/start`; an inline Web App button requires a user tap.
- `/api/miniapp/import-code` returns HTTP 500 when any code selection belongs to a started/unavailable fixture. Return a clear 409 for ineligible codes, and preferably display individual excluded legs rather than confusing them with server failures. A code with no safely editable selections must not offer code generation.
- `/api/miniapp/build` intermittently returns 409 and can take over 30 seconds; Redis cache access logs `Stream isn't writeable and enableOfflineQueue options is false`. Check AI research availability and Redis connection, instrument deterministic reason codes and distinguish no qualifying choices from provider/analysis outages.
- A global 68/100 evidence-quality gate currently applies to all odds categories. Scope 68 to explicit 2.00/5.00 targets, and use a defined 50–60 policy for all other targets. These scores are evidence-quality ratings, not calibrated win probabilities.
- The Mini App loads numerous overlapping CSS layers. Consolidate base/layout/glass tokens, check the phone viewport and contrast, prevent overrides accumulating, and test real navigation and the analyze/edit/code flow in Telegram.

Do not mark this incident resolved merely because a deployment reports READY. Confirm live requests, Telegram integration, full test suite, and production health first.
