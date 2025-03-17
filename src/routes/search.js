const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/search/repositories
 * @desc    Search for repositories
 * @access  Private
 */
router.get('/repositories', async (req, res) => {
  try {
    const { q, sort, order, page = 1, per_page = 30 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use the cached response if available
    const cacheKey = `search:repos:${q}:${sort || ''}:${order || ''}:${page}:${per_page}`;
    const cachedResults = req.cache.get(cacheKey);
    
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Search repositories through GitHub API
    const response = await req.octokit.rest.search.repos({
      q,
      sort,
      order,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching repositories:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/search/code
 * @desc    Search for code
 * @access  Private
 */
router.get('/code', async (req, res) => {
  try {
    const { q, sort, order, page = 1, per_page = 30 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use the cached response if available
    const cacheKey = `search:code:${q}:${sort || ''}:${order || ''}:${page}:${per_page}`;
    const cachedResults = req.cache.get(cacheKey);
    
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Search code through GitHub API
    const response = await req.octokit.rest.search.code({
      q,
      sort,
      order,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/search/issues
 * @desc    Search for issues and pull requests
 * @access  Private
 */
router.get('/issues', async (req, res) => {
  try {
    const { q, sort, order, page = 1, per_page = 30 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use the cached response if available
    const cacheKey = `search:issues:${q}:${sort || ''}:${order || ''}:${page}:${per_page}`;
    const cachedResults = req.cache.get(cacheKey);
    
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Search issues through GitHub API
    const response = await req.octokit.rest.search.issuesAndPullRequests({
      q,
      sort,
      order,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/search/users
 * @desc    Search for users
 * @access  Private
 */
router.get('/users', async (req, res) => {
  try {
    const { q, sort, order, page = 1, per_page = 30 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use the cached response if available
    const cacheKey = `search:users:${q}:${sort || ''}:${order || ''}:${page}:${per_page}`;
    const cachedResults = req.cache.get(cacheKey);
    
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Search users through GitHub API
    const response = await req.octokit.rest.search.users({
      q,
      sort,
      order,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/search/commits
 * @desc    Search for commits
 * @access  Private
 */
router.get('/commits', async (req, res) => {
  try {
    const { q, sort, order, page = 1, per_page = 30 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use the cached response if available
    const cacheKey = `search:commits:${q}:${sort || ''}:${order || ''}:${page}:${per_page}`;
    const cachedResults = req.cache.get(cacheKey);
    
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Search commits through GitHub API
    const response = await req.octokit.rest.search.commits({
      q,
      sort,
      order,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching commits:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/search/topics
 * @desc    Search for topics
 * @access  Private
 */
router.get('/topics', async (req, res) => {
  try {
    const { q, page = 1, per_page = 30 } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    // Use the cached response if available
    const cacheKey = `search:topics:${q}:${page}:${per_page}`;
    const cachedResults = req.cache.get(cacheKey);
    
    if (cachedResults) {
      return res.json(cachedResults);
    }
    
    // Search topics through GitHub API
    const response = await req.octokit.rest.search.topics({
      q,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching topics:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 