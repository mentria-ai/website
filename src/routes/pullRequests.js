const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/pull-requests/:owner/:repo
 * @desc    Get pull requests for a repository
 * @access  Private
 */
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { state = 'open', sort = 'created', direction = 'desc', page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `prs:${owner}/${repo}:${state}:${sort}:${direction}:${page}:${per_page}`;
    const cachedPRs = req.cache.get(cacheKey);
    
    if (cachedPRs) {
      return res.json(cachedPRs);
    }
    
    // Fetch pull requests from GitHub API
    const response = await req.octokit.rest.pulls.list({
      owner,
      repo,
      state,
      sort,
      direction,
      page,
      per_page
    });
    
    // Cache the response for 2 minutes (PRs change frequently)
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching pull requests:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/pull-requests/:owner/:repo/:pull_number
 * @desc    Get a specific pull request
 * @access  Private
 */
router.get('/:owner/:repo/:pull_number', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    
    // Use the cached response if available
    const cacheKey = `pr:${owner}/${repo}:${pull_number}`;
    const cachedPR = req.cache.get(cacheKey);
    
    if (cachedPR) {
      return res.json(cachedPR);
    }
    
    // Fetch pull request from GitHub API
    const response = await req.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: parseInt(pull_number)
    });
    
    // Cache the response for 2 minutes
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching pull request:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Pull request not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/pull-requests/:owner/:repo
 * @desc    Create a new pull request
 * @access  Private
 */
router.post('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { title, body, head, base, draft, maintainer_can_modify } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Pull request title is required' });
    }
    
    if (!head || !base) {
      return res.status(400).json({ error: 'Head and base branches are required' });
    }
    
    // Create pull request through GitHub API
    const response = await req.octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body: body || '',
      head,
      base,
      draft: draft || false,
      maintainer_can_modify: maintainer_can_modify || true
    });
    
    // Invalidate cache for pull requests list
    const cachePattern = new RegExp(`^prs:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating pull request:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   PATCH /api/pull-requests/:owner/:repo/:pull_number
 * @desc    Update a pull request
 * @access  Private
 */
router.patch('/:owner/:repo/:pull_number', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { title, body, state, base, maintainer_can_modify } = req.body;
    
    // Update pull request through GitHub API
    const response = await req.octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      title,
      body,
      state,
      base,
      maintainer_can_modify
    });
    
    // Invalidate caches
    req.cache.del(`pr:${owner}/${repo}:${pull_number}`);
    
    const cachePattern = new RegExp(`^prs:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error updating pull request:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Pull request not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/pull-requests/:owner/:repo/:pull_number/files
 * @desc    Get files changed in a pull request
 * @access  Private
 */
router.get('/:owner/:repo/:pull_number/files', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { page = 1, per_page = 100 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `pr:${owner}/${repo}:${pull_number}:files:${page}:${per_page}`;
    const cachedFiles = req.cache.get(cacheKey);
    
    if (cachedFiles) {
      return res.json(cachedFiles);
    }
    
    // Fetch files from GitHub API
    const response = await req.octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching pull request files:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Pull request not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/pull-requests/:owner/:repo/:pull_number/commits
 * @desc    Get commits in a pull request
 * @access  Private
 */
router.get('/:owner/:repo/:pull_number/commits', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `pr:${owner}/${repo}:${pull_number}:commits:${page}:${per_page}`;
    const cachedCommits = req.cache.get(cacheKey);
    
    if (cachedCommits) {
      return res.json(cachedCommits);
    }
    
    // Fetch commits from GitHub API
    const response = await req.octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching pull request commits:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Pull request not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/pull-requests/:owner/:repo/:pull_number/merge
 * @desc    Merge a pull request
 * @access  Private
 */
router.post('/:owner/:repo/:pull_number/merge', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { commit_title, commit_message, merge_method = 'merge', sha } = req.body;
    
    // Merge pull request through GitHub API
    const response = await req.octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      commit_title,
      commit_message,
      merge_method,
      sha
    });
    
    // Invalidate caches
    req.cache.del(`pr:${owner}/${repo}:${pull_number}`);
    
    const cachePattern = new RegExp(`^prs:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error merging pull request:', error);
    
    // Handle specific error cases with better messages
    if (error.status === 404) {
      return res.status(404).json({ error: 'Pull request not found' });
    } else if (error.status === 405) {
      return res.status(405).json({ error: 'Pull request cannot be merged' });
    } else if (error.status === 409) {
      return res.status(409).json({ error: 'Pull request has merge conflicts' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/pull-requests/:owner/:repo/:pull_number/reviews
 * @desc    Create a review for a pull request
 * @access  Private
 */
router.post('/:owner/:repo/:pull_number/reviews', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { body, event, comments } = req.body;
    
    if (!event) {
      return res.status(400).json({ error: 'Review event is required (APPROVE, REQUEST_CHANGES, or COMMENT)' });
    }
    
    // Create review through GitHub API
    const response = await req.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      body,
      event,
      comments
    });
    
    // Invalidate PR cache
    req.cache.del(`pr:${owner}/${repo}:${pull_number}`);
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating review:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Pull request not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 