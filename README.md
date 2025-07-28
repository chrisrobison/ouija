# Ouija

A virtual Ouija board built with PHP and JavaScript. It communicates with an LLM hosted via the DeepSeek API to produce short spirit responses. Spirit profiles are persisted on disk so conversations can continue across sessions.

## Features
- Spirit profiles stored in `spirits/` with conversation history.
- Special tokens like `<<NEW_SPIRIT>>` cause the backend to create and load a new spirit.
- Simple frontend (`index.html`) that displays the board and animated planchette.
- Jest tests for basic HTML behaviours.

## Setup
1. Install Node dependencies for tests:
   ```bash
   npm install
   ```
2. Provide a `DEEPSEEK_API_KEY` environment variable when running `ouija.php`.
3. Serve the PHP file locally, for example:
   ```bash
   php -S localhost:8000
   ```
4. Open `index.html` in your browser.

## Running Tests
Execute the test suite with:
```bash
npm test
```

## Repository Guidelines
See `AGENTS.md` for coding standards and testing requirements.
