const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');

/**
 * Initialize MCP routes with dependencies
 * @param {object} octokit - Authenticated Octokit instance
 * @param {object} cache - NodeCache instance
 * @param {object} wsService - WebSocket service
 * @returns {object} Express router
 */
module.exports = (octokit, cache, wsService) => {
  // Authenticate GitHub credentials and issue JWT
  router.post('/auth', async (req, res) => {
    const { username, token } = req.body;
    
    if (!username || !token) {
      return res.status(400).json({ error: 'Username and token are required' });
    }
    
    try {
      // Create a temporary Octokit instance with the provided token
      const tempOctokit = new (octokit.constructor)({
        auth: token,
        userAgent: 'GitHub MCP Server v1.0.0'
      });
      
      // Verify token with GitHub
      const response = await tempOctokit.rest.users.getAuthenticated();
      
      if (response.data.login === username) {
        // Create JWT
        const userJwt = jwt.sign(
          { 
            username,
            avatar: response.data.avatar_url,
            name: response.data.name || username
          }, 
          process.env.JWT_SECRET, 
          { expiresIn: process.env.JWT_EXPIRY || '8h' }
        );
        
        return res.json({ 
          token: userJwt,
          user: {
            username: response.data.login,
            avatar: response.data.avatar_url,
            name: response.data.name || username
          }
        });
      } else {
        return res.status(401).json({ error: 'Invalid GitHub credentials' });
      }
    } catch (error) {
      console.error('Authentication error:', error);
      return res.status(401).json({ error: 'GitHub authentication failed' });
    }
  });
  
  // MCP protocol endpoint
  router.post('/', verifyToken, async (req, res) => {
    const { action, params } = req.body;
    
    if (!action) {
      return res.status(400).json({ error: 'Action is required' });
    }
    
    console.log(`Received MCP request: ${action}`);
    
    // Check cache for repeated requests
    const cacheKey = `mcp:${action}:${JSON.stringify(params)}`;
    const cachedResponse = cache.get(cacheKey);
    
    if (cachedResponse) {
      console.log(`Cache hit for: ${cacheKey}`);
      return res.json(cachedResponse);
    }
    
    try {
      let result;
      
      // Route the MCP request to the appropriate handler
      switch (action) {
        case 'search_repositories':
          result = await searchRepositories(octokit, params);
          break;
          
        case 'create_repository':
          result = await createRepository(octokit, params);
          break;
          
        case 'get_file_contents':
          result = await getFileContents(octokit, params);
          break;
          
        case 'create_or_update_file':
          result = await createOrUpdateFile(octokit, params);
          break;
          
        case 'get_workflows':
          result = await getWorkflows(octokit, params);
          break;
          
        case 'run_workflow':
          result = await runWorkflow(octokit, params);
          break;
          
        case 'get_workflow_runs':
          result = await getWorkflowRuns(octokit, params);
          break;
          
        case 'get_repository':
          result = await getRepository(octokit, params);
          break;
          
        case 'get_branches':
          result = await getBranches(octokit, params);
          break;
          
        case 'create_branch':
          result = await createBranch(octokit, params);
          break;
          
        case 'get_issues':
          result = await getIssues(octokit, params);
          break;
          
        case 'create_issue':
          result = await createIssue(octokit, params);
          break;
          
        case 'get_pull_requests':
          result = await getPullRequests(octokit, params);
          break;
          
        case 'create_pull_request':
          result = await createPullRequest(octokit, params);
          break;
          
        case 'merge_pull_request':
          result = await mergePullRequest(octokit, params);
          break;
          
        case 'subscribe_to_repository':
          result = await subscribeToRepository(wsService, params, req.user);
          break;
          
        default:
          return res.status(400).json({ error: `Unsupported MCP action: ${action}` });
      }
      
      // Cache the response for read operations
      if (action.startsWith('get_') || action === 'search_repositories') {
        cache.set(cacheKey, { result });
      }
      
      return res.json({ result });
    } catch (error) {
      console.error(`Error handling MCP request: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
  });
  
  return router;
};

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

async function getRepository(octokit, params) {
  const { owner, repo } = params;
  
  const response = await octokit.rest.repos.get({
    owner,
    repo
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

async function getBranches(octokit, params) {
  const { owner, repo, protected: isProtected } = params;
  
  const response = await octokit.rest.repos.listBranches({
    owner,
    repo,
    protected: isProtected
  });
  
  return response.data;
}

async function createBranch(octokit, params) {
  const { owner, repo, name, sha } = params;
  
  const response = await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${name}`,
    sha
  });
  
  return response.data;
}

async function getIssues(octokit, params) {
  const { owner, repo, state = 'open', sort = 'created', direction = 'desc', page = 1, perPage = 30 } = params;
  
  const response = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    state,
    sort,
    direction,
    page,
    per_page: perPage
  });
  
  return response.data;
}

async function createIssue(octokit, params) {
  const { owner, repo, title, body, labels, assignees } = params;
  
  const response = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body,
    labels,
    assignees
  });
  
  return response.data;
}

async function getPullRequests(octokit, params) {
  const { owner, repo, state = 'open', sort = 'created', direction = 'desc', page = 1, perPage = 30 } = params;
  
  const response = await octokit.rest.pulls.list({
    owner,
    repo,
    state,
    sort,
    direction,
    page,
    per_page: perPage
  });
  
  return response.data;
}

async function createPullRequest(octokit, params) {
  const { owner, repo, title, body, head, base, draft = false } = params;
  
  const response = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
    draft
  });
  
  return response.data;
}

async function mergePullRequest(octokit, params) {
  const { owner, repo, pull_number, commit_title, commit_message, merge_method = 'merge' } = params;
  
  const response = await octokit.rest.pulls.merge({
    owner,
    repo,
    pull_number,
    commit_title,
    commit_message,
    merge_method
  });
  
  return response.data;
}

// GitHub Actions Workflow functions
async function getWorkflows(octokit, params) {
  const { owner, repo } = params;
  
  const response = await octokit.rest.actions.listRepoWorkflows({
    owner,
    repo
  });
  
  return response.data;
}

async function runWorkflow(octokit, params) {
  const { owner, repo, workflow_id, ref, inputs } = params;
  
  const response = await octokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id,
    ref,
    inputs
  });
  
  return { success: true, status: response.status };
}

async function getWorkflowRuns(octokit, params) {
  const { owner, repo, workflow_id, status, per_page = 30 } = params;
  
  const response = await octokit.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id,
    status,
    per_page
  });
  
  return response.data;
}

// WebSocket subscription helper
async function subscribeToRepository(wsService, params, user) {
  const { owner, repo } = params;
  
  if (!owner || !repo) {
    throw new Error('Owner and repo are required');
  }
  
  const result = await wsService.subscribeToRepository(owner, repo);
  
  return {
    success: result.success,
    message: result.message || `Subscribed to ${owner}/${repo} events`,
    owner,
    repo
  };
} 