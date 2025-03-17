# GitHub MCP Server

A GitHub MCP (Multi-Context Protocol) server for direct integration with Cursor IDE.

## Overview

This project provides a server that implements the MCP protocol to allow Cursor IDE to interact directly with GitHub. Instead of switching contexts between your IDE and GitHub's web interface, you can perform common GitHub operations right from within Cursor.

## Features

- Authentication with GitHub Personal Access Tokens
- Repository management (list, create, view, delete)
- File operations (view, create, update, delete)
- Issue management (list, create, update, comment)
- Pull request operations
- Branch management
- Search capabilities

## Requirements

- Node.js (v14+)
- npm or yarn
- GitHub Personal Access Token

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/github-mcp-server.git
   cd github-mcp-server
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on the provided `.env.example`:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file and add your GitHub personal access token and other configuration.

5. Start the server:
   ```
   npm start
   ```

For development:
```
npm run dev
```

## API Endpoints

The server provides RESTful API endpoints for GitHub operations:

- `/api/auth` - Authentication
- `/api/repositories` - Repository operations
- `/api/files` - File operations
- `/api/issues` - Issue management
- `/api/pull-requests` - PR operations
- `/api/search` - Search functionality
- `/api/branches` - Branch operations

## MCP Integration

The server also provides an MCP endpoint at `/mcp` that accepts and processes MCP requests from Cursor IDE. This endpoint supports various GitHub operations including:

- `search_repositories`
- `create_repository`
- `get_file_contents`
- `create_or_update_file`
- And many more

## Security

This server uses JWT for authentication between the client and the server. Your GitHub Personal Access Token is stored securely in your environment and never exposed to clients.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details. 