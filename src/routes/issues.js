const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/issues/:owner/:repo
 * @desc    Get issues for a repository
 * @access  Private
 */
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { state = 'open', sort = 'created', direction = 'desc', page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `issues:${owner}/${repo}:${state}:${sort}:${direction}:${page}:${per_page}`;
    const cachedIssues = req.cache.get(cacheKey);
    
    if (cachedIssues) {
      return res.json(cachedIssues);
    }
    
    // Fetch issues from GitHub API
    const response = await req.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state,
      sort,
      direction,
      page,
      per_page
    });
    
    // Cache the response for 2 minutes (issues change frequently)
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching issues:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/issues/:owner/:repo/:issue_number
 * @desc    Get a specific issue
 * @access  Private
 */
router.get('/:owner/:repo/:issue_number', async (req, res) => {
  try {
    const { owner, repo, issue_number } = req.params;
    
    // Use the cached response if available
    const cacheKey = `issue:${owner}/${repo}:${issue_number}`;
    const cachedIssue = req.cache.get(cacheKey);
    
    if (cachedIssue) {
      return res.json(cachedIssue);
    }
    
    // Fetch issue from GitHub API
    const response = await req.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: parseInt(issue_number)
    });
    
    // Cache the response for 2 minutes
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching issue:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/issues/:owner/:repo
 * @desc    Create a new issue
 * @access  Private
 */
router.post('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, labels, assignees, milestone } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Issue title is required' });
    }
    
    // Create issue through GitHub API
    const response = await req.octokit.rest.issues.create({
      owner,
      repo,
      title,
      body: body || '',
      labels,
      assignees,
      milestone
    });
    
    // Invalidate cache for issues list
    const cachePattern = new RegExp(`^issues:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating issue:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   PATCH /api/issues/:owner/:repo/:issue_number
 * @desc    Update an issue
 * @access  Private
 */
router.patch('/:owner/:repo/:issue_number', async (req, res) => {
  try {
    const { owner, repo, issue_number } = req.params;
    const { title, body, state, labels, assignees, milestone } = req.body;
    
    // Update issue through GitHub API
    const response = await req.octokit.rest.issues.update({
      owner,
      repo,
      issue_number: parseInt(issue_number),
      title,
      body,
      state,
      labels,
      assignees,
      milestone
    });
    
    // Invalidate caches
    req.cache.del(`issue:${owner}/${repo}:${issue_number}`);
    
    const cachePattern = new RegExp(`^issues:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error updating issue:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/issues/:owner/:repo/:issue_number/comments
 * @desc    Add a comment to an issue
 * @access  Private
 */
router.post('/:owner/:repo/:issue_number/comments', async (req, res) => {
  try {
    const { owner, repo, issue_number } = req.params;
    const { body } = req.body;
    
    if (!body) {
      return res.status(400).json({ error: 'Comment body is required' });
    }
    
    // Create comment through GitHub API
    const response = await req.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: parseInt(issue_number),
      body
    });
    
    // Invalidate issue cache
    req.cache.del(`issue:${owner}/${repo}:${issue_number}`);
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating comment:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/issues/:owner/:repo/:issue_number/comments
 * @desc    Get comments for an issue
 * @access  Private
 */
router.get('/:owner/:repo/:issue_number/comments', async (req, res) => {
  try {
    const { owner, repo, issue_number } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `issue:${owner}/${repo}:${issue_number}:comments:${page}:${per_page}`;
    const cachedComments = req.cache.get(cacheKey);
    
    if (cachedComments) {
      return res.json(cachedComments);
    }
    
    // Fetch comments from GitHub API
    const response = await req.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: parseInt(issue_number),
      page,
      per_page
    });
    
    // Cache the response for 2 minutes
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching comments:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Issue not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/issues/assigned
 * @desc    Get issues assigned to the authenticated user
 * @access  Private
 */
router.get('/assigned', async (req, res) => {
  try {
    const { state = 'open', sort = 'created', direction = 'desc', page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `issues:assigned:${state}:${sort}:${direction}:${page}:${per_page}`;
    const cachedIssues = req.cache.get(cacheKey);
    
    if (cachedIssues) {
      return res.json(cachedIssues);
    }
    
    // Fetch assigned issues from GitHub API
    const response = await req.octokit.rest.issues.listForAuthenticatedUser({
      filter: 'assigned',
      state,
      sort,
      direction,
      page,
      per_page
    });
    
    // Cache the response for 2 minutes
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching assigned issues:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 