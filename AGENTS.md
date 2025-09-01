# Repository Guidelines

This document is a concise contributor guide for this repository. Follow the examples and commands below when developing, testing, and submitting changes.

## Project Structure & Module Organization

- **Source:** `src/` or top-level JS files — check the repository root for `package.json` to confirm structure.
- **Tests:** `test/` or files next to modules named with `.test.js`/`.spec.js`.
- **Assets:** `public/`, `static/`, or `assets/` for images and static content.

Examples:
- Code: `src/components/Button.js`
- Tests: `test/button.test.js`

## Build, Test, and Development Commands

- Install deps: `npm install` — run if `node_modules` is missing.
- Run tests: `npm test` — executes the test script defined in `package.json`.
- Build (if available): `npm run build` — transpile/bundle for production.
- Dev server: `npm run dev` or `npm start` — run the app locally.

Check `package.json` for exact scripts available in this repo.

## Coding Style & Naming Conventions

- Indentation: 4 spaces.
- Line length: keep under 120 characters.
- Filenames: use `kebab-case` for files and `PascalCase` for React components.
- Variables & functions: use `camelCase`.
- Use descriptive names; avoid one-letter identifiers.

If linters/formatters are configured, run `npm run lint` or `npm run format`.

## Testing Guidelines

- Use the test runner defined in `package.json` (e.g., Jest or Mocha).
- Test files: append `.test.js` or `.spec.js` next to the module under test.
- Run `npm test` before committing; aim for meaningful unit coverage for changed modules.

## Commit & Pull Request Guidelines

- Commit messages: short subject (50 chars) + optional body. Use present tense: `Add`, `Fix`, `Update`.
- PRs should include a description, linked issue (if any), and screenshots for UI changes.
- Break large changes into multiple PRs focused on a single concern.

## Security & Configuration Tips

- Do not commit secrets or credentials. Use environment variables and `.env` files (add to `.gitignore`).
- Check `package.json` for dependency updates and run audits: `npm audit`.

If anything here is ambiguous, open an issue or ask maintainers for repository-specific conventions.

