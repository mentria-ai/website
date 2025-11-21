# Website [mentria.ai](mentria.ai)

This repository contains the code and configuration for the **mentria.ai** website – an all-purpose site that is currently **under development**. At present, only a screensaver page is visible. This site (and repo) is powered and maintained by an AI agent capable of performing various tasks such as coding, making pull requests, tagging issues, testing, and discussions.

---

## Table of Contents
1. [Overview](#overview)  
2. [Features](#features)  
3. [Tech Stack & AI Integration](#tech-stack--ai-integration)  
4. [Getting Started](#getting-started)  
5. [Project Status & Roadmap](#project-status--roadmap)  
6. [Contributing](#contributing)  
7. [License](#license)  
8. [Contact](#contact)

---

## Overview
- **Goal:** Maintain the mentria.ai website and enable an AI agent to manage tasks in this and other repositories.
- **Current State:** Under development, showing a screensaver page.
- **AI Agent:** Utilizes GitHub Actions to connect with Together AI API and open-source models to simulate agentic behaviors.

---

## Features
1. **AI-Driven Website**  
   - Automated updates and commits by an AI agent.
   - Potential for dynamic page generation in the future.

2. **GitHub Actions Integration**  
   - Automated workflows triggering the AI to handle tasks such as building, testing, or making pull requests.

3. **Agentic Behaviors**  
   - Creation and management of issues, PRs, code reviews, and repository discussions.

---

## Tech Stack & AI Integration
- **Tech Stack:**  
  - GitHub Actions for CI/CD and AI pipeline triggers.  
  - Together AI API or local open-source models (via Ollama) for AI inference and agent decision-making.

- **AI Agent Setup:**  
  - Runs as a GitHub App or uses GitHub directly, depending on user preferences.  
  - Manages repository tasks (coding, tagging, testing, discussions, etc.) automatically.

---

## Getting Started
1. **Fork & Clone**  
   - Fork this repository to your GitHub account and then clone it locally.

2. **Configure AI Access**  
   - Add the necessary environment variables or config for the Together AI API OR  
   - Set up a local runner (using Ollama or another local model solution) to power the agent.

3. **Sync and Update**  
   - The AI agent will fetch new updates via GitHub.  
   - Once configured, it can handle tasks automatically or prompt you for help when needed.

> **Note:** Specific usage instructions will be provided once the project reaches a more stable stage.

---

## Project Status & Roadmap
- **Status:** Active development; the website is in a placeholder/screen-saver phase.  
- **Roadmap Highlights:**  
  1. Expand AI agent capabilities for more robust automation.  
  2. Implement a fully functional front-end for mentria.ai.  
  3. Integrate additional open-source models and explore advanced automation workflows.

> For more details about upcoming milestones and goals, refer to [Issues](../../issues) or [Discussions](../../discussions) as they evolve.

---

## Contributing
We appreciate your interest in contributing! Right now, a simple ⭐ (star) on the repository is enough to show your support. In the future, we'll welcome pull requests, issue reports, and code contributions as the project matures.

---

## License
This project is licensed under the [MIT License](LICENSE). Feel free to use and modify the code for your own projects under the terms of this license.

---

## Contact
If you have questions or suggestions, please reach out via:
- [GitHub Issues](../../issues)  
- [GitHub Discussions](../../discussions)

We look forward to your feedback and support as the mentria.ai project evolves!

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
