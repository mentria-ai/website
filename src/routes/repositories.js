const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/repositories
 * @desc    Get all repositories for the authenticated user
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    // Use the cached response if available
    const cacheKey = 'repos:user';
    const cachedRepos = req.cache.get(cacheKey);
    
    if (cachedRepos) {
      return res.json(cachedRepos);
    }
    
    // Fetch repositories from GitHub API
    const response = await req.octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching repositories:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/repositories/:owner/:repo
 * @desc    Get a specific repository
 * @access  Private
 */
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    // Use the cached response if available
    const cacheKey = `repo:${owner}/${repo}`;
    const cachedRepo = req.cache.get(cacheKey);
    
    if (cachedRepo) {
      return res.json(cachedRepo);
    }
    
    // Fetch repository from GitHub API
    const response = await req.octokit.rest.repos.get({
      owner,
      repo
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching repository:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/repositories
 * @desc    Create a new repository
 * @access  Private
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, private: isPrivate, auto_init } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    // Create repository through GitHub API
    const response = await req.octokit.rest.repos.createForAuthenticatedUser({
      name,
      description: description || '',
      private: isPrivate || false,
      auto_init: auto_init || true
    });
    
    // Invalidate cache for user repositories
    req.cache.del('repos:user');
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating repository:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   DELETE /api/repositories/:owner/:repo
 * @desc    Delete a repository
 * @access  Private
 */
router.delete('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    // Delete repository through GitHub API
    await req.octokit.rest.repos.delete({
      owner,
      repo
    });
    
    // Invalidate caches
    req.cache.del(`repo:${owner}/${repo}`);
    req.cache.del('repos:user');
    
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting repository:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/repositories/:owner/:repo/branches
 * @desc    Get all branches for a repository
 * @access  Private
 */
router.get('/:owner/:repo/branches', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    // Use the cached response if available
    const cacheKey = `branches:${owner}/${repo}`;
    const cachedBranches = req.cache.get(cacheKey);
    
    if (cachedBranches) {
      return res.json(cachedBranches);
    }
    
    // Fetch branches from GitHub API
    const response = await req.octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/repositories/:owner/:repo/contributors
 * @desc    Get all contributors for a repository
 * @access  Private
 */
router.get('/:owner/:repo/contributors', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    
    // Use the cached response if available
    const cacheKey = `contributors:${owner}/${repo}`;
    const cachedContributors = req.cache.get(cacheKey);
    
    if (cachedContributors) {
      return res.json(cachedContributors);
    }
    
    // Fetch contributors from GitHub API
    const response = await req.octokit.rest.repos.listContributors({
      owner,
      repo,
      per_page: 100
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching contributors:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 