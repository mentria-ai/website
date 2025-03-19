# GitHub Assistant System

A modular system for AI-powered GitHub assistants that can respond to issues and discussions with context-aware responses.

## Overview

This system provides two GitHub Action workflows:

1. **Discussion Assistant**: Responds to new discussions and comments with AI-generated responses.
2. **Issue Assistant**: Responds to new issues and comments with AI-generated responses, with added repository context awareness.

Both assistants are built on a modular architecture that shares common components for maintainability and code reuse.

## Features

- Automatic responses to issues and discussions
- Context-aware conversations (previous comment history)
- Repository context analysis for issue responses
- Separate thinking blocks in AI responses presented as quote blocks
- Robust error handling and logging
- Modular architecture for easy maintenance and extension

## Architecture

The system is organized into reusable modules:

```
.github/
├── workflows/
│   ├── discussion-assistant.yml
│   └── issue-assistant.yml
└── shared/
    ├── api/
    │   └── together-ai.js
    ├── event-handlers/
    │   └── event-extractor.js
    ├── repo-context/
    │   └── context-analyzer.js
    ├── response-handlers/
    │   └── github-response.js
    └── utils/
        ├── logging.js
        └── prompt-builder.js
```

### Modules

1. **API Integration**: Handles communication with Together AI's API with automatic retry logic.
2. **Event Handlers**: Extract content from GitHub events (issues, discussions, comments).
3. **Repository Context**: Analyzes if repository context is needed and extracts relevant code files.
4. **Response Handlers**: Post AI-generated responses back to GitHub discussions or issues.
5. **Utilities**: Common utilities for logging and prompt building.

## Repository Context Analysis

The Issue Assistant includes a two-step process for repository context:

1. **Context Needs Analysis**: Determines if repository context would help answer the issue.
2. **Relevant File Selection**: If context is needed, selects up to 10 most relevant files.

This approach ensures that the AI only processes repository files when relevant, improving response quality and reducing unnecessary API costs.

## How It Works

### Discussion Assistant

1. Triggered by new discussions or comments
2. Extracts content from the event
3. Gathers previous comments for context
4. Generates an AI response using Together AI
5. Posts the response back to the discussion

### Issue Assistant

1. Triggered by new issues or comments
2. Extracts content from the event
3. Determines if repository context is needed
4. If needed, selects and extracts relevant code files
5. Generates an AI response with context
6. Posts the response back to the issue

## Response Format

AI responses include reasoning in separate thinking blocks, which are rendered as quote blocks in GitHub. For example:

```
I've looked at your issue and have a solution.

> **Thinking process:**
> This appears to be a React state management issue. The user is trying to update a state variable directly, which won't trigger a re-render.
> They should be using the setState function instead.

You're attempting to modify the state directly with `this.state.count = 5`, but in React you need to use the setState method instead:

```jsx
this.setState({ count: 5 });
```

This ensures that React knows the state has changed and will re-render your component.
```

## Configuration

To use these workflows, you need:

1. A Together AI API key stored as a repository secret named `TOGETHER_API_KEY`
2. Appropriate GitHub permissions in the workflow YAML files

## Extending the System

The modular design makes it easy to:

1. Add new assistants for different GitHub events
2. Change the underlying AI model
3. Enhance context capabilities
4. Add more sophisticated response handling

## License

MIT 