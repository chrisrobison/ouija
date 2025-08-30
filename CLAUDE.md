# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a virtual Ouija board web application that uses AI-powered spirits to create an immersive paranormal experience. The system combines a PHP backend with a JavaScript frontend to simulate communication with historical spirits.

### Core Architecture

**Backend (PHP)**:
- `ouija.php` - Main API endpoint handling spirit interactions, profile management, and DeepSeek LLM integration
- Spirit profiles stored as JSON files in `spirits/` directory with conversation history
- Uses DeepSeek API for generating spirit responses and creating new spirit personas

**Frontend (HTML/JavaScript)**:
- `index.html` - Single-page application with animated planchette and responsive design
- Real-time speech recognition for voice input via Web Speech API
- Animated planchette movement spelling out responses letter by letter
- Conversation history display with mobile-optimized layout

**Spirit System**:
- Persistent spirit profiles with detailed historical backgrounds (name, occupation, birth/death years, etc.)
- Conversation memory maintained per spirit across sessions
- Special token `<<NEW_SPIRIT>>` triggers automatic spirit switching
- Profile validation and cleanup to ensure data integrity

## Development Commands

### Setup
```bash
npm install                    # Install test dependencies
```

### Testing
```bash
npm test                      # Run Jest test suite
```

### Local Development
```bash
php -S localhost:8000         # Start PHP development server
```

Then open `index.html` in your browser.

### Environment Configuration
- Requires `DEEPSEEK_API_KEY` environment variable or `.env` file
- API key should be set for DeepSeek API access

## Key Development Patterns

### Spirit Management
- Spirit profiles are automatically generated with historical authenticity
- Each spirit has a unique `_id` based on slugified name and birth year
- Conversation history is limited to `MEM_DEPTH` (30) turns to manage token usage
- Invalid spirit files are automatically cleaned up on startup

### API Endpoints
- `?action=ask` (default) - Submit question and get spirit response
- `?action=reset` - Create and switch to a new random spirit
- `?action=list` - Display all available spirits with details
- `?action=switch&name=<name>` - Switch to existing spirit by name (supports partial matching)
- `?action=profile` - Get current spirit's profile as JSON
- `?action=history&n=<count>` - Get conversation history

### Frontend Features
- Letter-by-letter animation with precise board positioning
- Touch and pointer event handling for mobile devices
- Speech recognition with hold-to-talk functionality
- Responsive design that scales planchette and board proportionally
- Help modal with localStorage persistence

## Code Style Guidelines

From `AGENTS.md`:
- Use 4 spaces for indentation
- Keep line length under 120 characters when possible
- Write descriptive comments for complex logic
- Run `npm test` before committing changes

## Testing Strategy

The project uses Jest for testing basic HTML behaviors and mobile enhancements. Tests verify:
- Proper viewport meta tag configuration
- Touch action disabled on board container
- Context menu prevention on planchette

## Security Considerations

- API keys are stored in `.env` file (not committed to repository)
- CORS is enabled for cross-origin requests
- Input sanitization for spirit responses
- File system operations are contained within `spirits/` directory

## Mobile Optimization

The application is fully responsive with:
- Scaled board and planchette based on viewport
- Touch-optimized controls and gesture handling  
- Disabled text selection and context menus during interaction
- Flexible layout switching to vertical stack on small screens