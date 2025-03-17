require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Octokit } = require('octokit');
const jwt = require('jsonwebtoken');

// Import route handlers
const repositoryRoutes = require('./routes/repositories');
const fileRoutes = require('./routes/files');
const issueRoutes = require('./routes/issues');
const pullRequestRoutes = require('./routes/pullRequests');
const searchRoutes = require('./routes/search');
const branchRoutes = require('./routes/branches');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// Setup middleware
app.use(cors());
app.use(express.json());

// Initialize Octokit with GitHub token
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Make octokit available to all routes
app.use((req, res, next) => {
  req.octokit = octokit;
  next();
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication token required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Register routes
app.use('/api/repositories', authenticateToken, repositoryRoutes);
app.use('/api/files', authenticateToken, fileRoutes);
app.use('/api/issues', authenticateToken, issueRoutes);
app.use('/api/pull-requests', authenticateToken, pullRequestRoutes);
app.use('/api/search', authenticateToken, searchRoutes);
app.use('/api/branches', authenticateToken, branchRoutes);

// Basic authentication endpoint
app.post('/api/auth', (req, res) => {
  const { username, token } = req.body;
  
  if (!username || !token) {
    return res.status(400).json({ error: 'Username and token are required' });
  }
  
  // Verify token with GitHub
  octokit.rest.users.getAuthenticated()
    .then(response => {
      if (response.data.login === username) {
        // Create JWT
        const userJwt = jwt.sign({ username }, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRY || '8h'
        });
        
        return res.json({ 
          token: userJwt,
          user: {
            username: response.data.login,
            avatar: response.data.avatar_url,
            name: response.data.name
          }
        });
      } else {
        return res.status(401).json({ error: 'Invalid GitHub credentials' });
      }
    })
    .catch(error => {
      console.error('Authentication error:', error);
      return res.status(401).json({ error: 'GitHub authentication failed' });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// MCP handling endpoint
app.post('/mcp', authenticateToken, async (req, res) => {
  const { action, params } = req.body;
  
  console.log(`Received MCP request: ${action}`);
  
  try {
    // Route the MCP request to the appropriate handler
    switch (action) {
      case 'search_repositories':
        const repos = await searchRepositories(req.octokit, params);
        return res.json({ result: repos });
        
      case 'create_repository':
        const newRepo = await createRepository(req.octokit, params);
        return res.json({ result: newRepo });
        
      case 'get_file_contents':
        const fileContents = await getFileContents(req.octokit, params);
        return res.json({ result: fileContents });
        
      case 'create_or_update_file':
        const fileUpdate = await createOrUpdateFile(req.octokit, params);
        return res.json({ result: fileUpdate });
        
      // Add more action handlers as needed
        
      default:
        return res.status(400).json({ error: `Unsupported MCP action: ${action}` });
    }
  } catch (error) {
    console.error(`Error handling MCP request: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`GitHub MCP server running at http://${HOST}:${PORT}`);
});

// MCP action handlers
async function searchRepositories(octokit, params) {
  const { query, page = 1, perPage = 30 } = params;
  
  const response = await octokit.rest.search.repos({
    q: query,
    page,
    per_page: perPage
  });
  
  return response.data;
}

async function createRepository(octokit, params) {
  const { name, description, private: isPrivate, autoInit } = params;
  
  const response = await octokit.rest.repos.createForAuthenticatedUser({
    name,
    description,
    private: isPrivate,
    auto_init: autoInit
  });
  
  return response.data;
}

async function getFileContents(octokit, params) {
  const { owner, repo, path, branch } = params;
  
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
    ref: branch
  });
  
  return response.data;
}

async function createOrUpdateFile(octokit, params) {
  const { owner, repo, path, message, content, branch, sha } = params;
  
  // Base64 encode the content if it's not already encoded
  const contentEncoded = Buffer.from(content).toString('base64');
  
  const response = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: contentEncoded,
    branch,
    sha
  });
  
  return response.data;
}

// Export the app for testing
module.exports = app; 