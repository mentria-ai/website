const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');

/**
 * Initialize API routes with dependencies
 * @param {object} octokit - Authenticated Octokit instance
 * @param {object} cache - NodeCache instance
 * @returns {object} Express router
 */
module.exports = (octokit, cache) => {
  // Apply authentication middleware to all API routes
  router.use(verifyToken);
  
  // Repository routes
  router.get('/repositories', async (req, res) => {
    try {
      const { visibility = 'all', affiliation = 'owner', sort = 'updated', direction = 'desc', page = 1, per_page = 30 } = req.query;
      
      const cacheKey = `repos:${visibility}:${affiliation}:${sort}:${direction}:${page}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.repos.listForAuthenticatedUser({
        visibility,
        affiliation,
        sort,
        direction,
        page,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error('Error fetching repositories:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.get('/repositories/:owner/:repo', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      
      const cacheKey = `repo:${owner}:${repo}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.repos.get({
        owner,
        repo
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching repository ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.post('/repositories', async (req, res) => {
    try {
      const { name, description, private: isPrivate, auto_init } = req.body;
      
      const response = await octokit.rest.repos.createForAuthenticatedUser({
        name,
        description,
        private: isPrivate,
        auto_init
      });
      
      res.status(201).json(response.data);
    } catch (error) {
      console.error('Error creating repository:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // File routes
  router.get('/repositories/:owner/:repo/contents/:path(*)', async (req, res) => {
    try {
      const { owner, repo, path } = req.params;
      const { ref } = req.query;
      
      const cacheKey = `contents:${owner}:${repo}:${path}:${ref || 'default'}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching file contents for ${req.params.path}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.put('/repositories/:owner/:repo/contents/:path(*)', async (req, res) => {
    try {
      const { owner, repo, path } = req.params;
      const { message, content, sha, branch } = req.body;
      
      // Base64 encode the content if it's not already encoded
      const contentEncoded = Buffer.from(content).toString('base64');
      
      const response = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: contentEncoded,
        sha,
        branch
      });
      
      res.json(response.data);
    } catch (error) {
      console.error(`Error updating file ${req.params.path}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Branch routes
  router.get('/repositories/:owner/:repo/branches', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { protected: isProtected } = req.query;
      
      const cacheKey = `branches:${owner}:${repo}:${isProtected || 'all'}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.repos.listBranches({
        owner,
        repo,
        protected: isProtected
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching branches for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.post('/repositories/:owner/:repo/branches', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { name, sha } = req.body;
      
      const response = await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${name}`,
        sha
      });
      
      res.status(201).json(response.data);
    } catch (error) {
      console.error(`Error creating branch for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Issue routes
  router.get('/repositories/:owner/:repo/issues', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { state = 'open', sort = 'created', direction = 'desc', page = 1, per_page = 30 } = req.query;
      
      const cacheKey = `issues:${owner}:${repo}:${state}:${sort}:${direction}:${page}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state,
        sort,
        direction,
        page,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching issues for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.post('/repositories/:owner/:repo/issues', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { title, body, labels, assignees } = req.body;
      
      const response = await octokit.rest.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
        assignees
      });
      
      res.status(201).json(response.data);
    } catch (error) {
      console.error(`Error creating issue for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Pull request routes
  router.get('/repositories/:owner/:repo/pulls', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { state = 'open', sort = 'created', direction = 'desc', page = 1, per_page = 30 } = req.query;
      
      const cacheKey = `pulls:${owner}:${repo}:${state}:${sort}:${direction}:${page}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.pulls.list({
        owner,
        repo,
        state,
        sort,
        direction,
        page,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching pull requests for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.post('/repositories/:owner/:repo/pulls', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      const { title, body, head, base, draft = false } = req.body;
      
      const response = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
        draft
      });
      
      res.status(201).json(response.data);
    } catch (error) {
      console.error(`Error creating pull request for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.put('/repositories/:owner/:repo/pulls/:pull_number/merge', async (req, res) => {
    try {
      const { owner, repo, pull_number } = req.params;
      const { commit_title, commit_message, merge_method = 'merge' } = req.body;
      
      const response = await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number,
        commit_title,
        commit_message,
        merge_method
      });
      
      res.json(response.data);
    } catch (error) {
      console.error(`Error merging pull request #${req.params.pull_number}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Workflow routes
  router.get('/repositories/:owner/:repo/workflows', async (req, res) => {
    try {
      const { owner, repo } = req.params;
      
      const cacheKey = `workflows:${owner}:${repo}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.actions.listRepoWorkflows({
        owner,
        repo
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching workflows for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.post('/repositories/:owner/:repo/workflows/:workflow_id/dispatches', async (req, res) => {
    try {
      const { owner, repo, workflow_id } = req.params;
      const { ref, inputs } = req.body;
      
      const response = await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id,
        ref,
        inputs
      });
      
      res.status(204).json({ success: true });
    } catch (error) {
      console.error(`Error dispatching workflow for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.get('/repositories/:owner/:repo/workflows/:workflow_id/runs', async (req, res) => {
    try {
      const { owner, repo, workflow_id } = req.params;
      const { status, per_page = 30 } = req.query;
      
      const cacheKey = `workflow_runs:${owner}:${repo}:${workflow_id}:${status || 'all'}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id,
        status,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error(`Error fetching workflow runs for ${req.params.owner}/${req.params.repo}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Search routes
  router.get('/search/repositories', async (req, res) => {
    try {
      const { q, sort, order, page = 1, per_page = 30 } = req.query;
      
      if (!q) {
        return res.status(400).json({ error: 'Search query is required' });
      }
      
      const cacheKey = `search:repos:${q}:${sort || 'default'}:${order || 'default'}:${page}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.search.repos({
        q,
        sort,
        order,
        page,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error('Error searching repositories:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.get('/search/code', async (req, res) => {
    try {
      const { q, sort, order, page = 1, per_page = 30 } = req.query;
      
      if (!q) {
        return res.status(400).json({ error: 'Search query is required' });
      }
      
      const cacheKey = `search:code:${q}:${sort || 'default'}:${order || 'default'}:${page}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.search.code({
        q,
        sort,
        order,
        page,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error('Error searching code:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  router.get('/search/issues', async (req, res) => {
    try {
      const { q, sort, order, page = 1, per_page = 30 } = req.query;
      
      if (!q) {
        return res.status(400).json({ error: 'Search query is required' });
      }
      
      const cacheKey = `search:issues:${q}:${sort || 'default'}:${order || 'default'}:${page}:${per_page}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return res.json(cachedData);
      }
      
      const response = await octokit.rest.search.issuesAndPullRequests({
        q,
        sort,
        order,
        page,
        per_page
      });
      
      cache.set(cacheKey, response.data);
      res.json(response.data);
    } catch (error) {
      console.error('Error searching issues:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  return router;
}; 