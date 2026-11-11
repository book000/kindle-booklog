# GitHub Copilot review instructions

Follow `AGENTS.md` at the repository root for the project overview, commands, structure and conventions. This file only lists what to check in reviews.

## Language

- Deliverables (PR/Issue text, code comments, JSDoc, documentation) are written in Japanese, with a half-width space between Japanese and alphanumeric characters.
- Runtime messages (logs, errors) are English.

## Review checklist

- Secrets: no Amazon credentials, Discord webhook URLs, proxy credentials or OTP secrets in code, logs or tests, and no personal information in logs. They live in `data/config.json` (git-ignored). The Booklog login form must never be auto-submitted, and the `/data/userdata` browser profile is treated as sensitive data.
- Puppeteer robustness: selectors and URLs are constants, and waits are explicit (`page.waitForSelector()` and similar) rather than fixed sleeps.
- Error handling: async code logs errors and does not swallow them.
- Duplicate detection: the check that compares Booklog's exported CSV `itemId` with the Kindle ASIN must not break, otherwise books are registered or notified twice.
- Comments explain why, not what. New or changed public functions and interfaces have JSDoc, and it matches the implementation.
- Report any use of `skipLibCheck` to work around type errors (it is forbidden).
- Do not flag: formatting issues that Prettier, ESLint and tsc already enforce; the infinite loop in `entrypoint.sh` (a 10-minute re-run loop by design); the use of `puppeteer-core` (Chromium is provided by the runtime).
