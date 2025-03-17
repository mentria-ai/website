const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/search/repositories
 * @desc    Search for repositories
 * @access  Private
 */
router.get('/repositories', async (req, res) => {
  try {
    const { 
      q, 
      sort, 
      order = 'desc', 
      page = 1, 
      per_page = 30 
    } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const params = {
      q,
      order,
      page: parseInt(page),
      per_page: parseInt(per_page)
    };
    
    if (sort) params.sort = sort;
    
    const response = await req.octokit.rest.search.repos(params);
    
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
    const { 
      q, 
      sort, 
      order = 'desc', 
      page = 1, 
      per_page = 30 
    } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const params = {
      q,
      order,
      page: parseInt(page),
      per_page: parseInt(per_page)
    };
    
    if (sort) params.sort = sort;
    
    const response = await req.octokit.rest.search.code(params);
    
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
    const { 
      q, 
      sort, 
      order = 'desc', 
      page = 1, 
      per_page = 30 
    } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const params = {
      q,
      order,
      page: parseInt(page),
      per_page: parseInt(per_page)
    };
    
    if (sort) params.sort = sort;
    
    const response = await req.octokit.rest.search.issuesAndPullRequests(params);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching issues and pull requests:', error);
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
    const { 
      q, 
      sort, 
      order = 'desc', 
      page = 1, 
      per_page = 30 
    } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const params = {
      q,
      order,
      page: parseInt(page),
      per_page: parseInt(per_page)
    };
    
    if (sort) params.sort = sort;
    
    const response = await req.octokit.rest.search.users(params);
    
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
    const { 
      q, 
      sort, 
      order = 'desc', 
      page = 1, 
      per_page = 30 
    } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const params = {
      q,
      order,
      page: parseInt(page),
      per_page: parseInt(per_page)
    };
    
    if (sort) params.sort = sort;
    
    const response = await req.octokit.rest.search.commits(params);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error searching commits:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 