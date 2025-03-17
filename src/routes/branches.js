const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/branches/:owner/:repo
 * @desc    Get all branches for a repository
 * @access  Private
 */
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { protected: isProtected, page = 1, per_page = 100 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `branches:${owner}/${repo}:${isProtected || ''}:${page}:${per_page}`;
    const cachedBranches = req.cache.get(cacheKey);
    
    if (cachedBranches) {
      return res.json(cachedBranches);
    }
    
    // Fetch branches from GitHub API
    const response = await req.octokit.rest.repos.listBranches({
      owner,
      repo,
      protected: isProtected === 'true',
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/branches/:owner/:repo/:branch
 * @desc    Get a specific branch
 * @access  Private
 */
router.get('/:owner/:repo/:branch', async (req, res) => {
  try {
    const { owner, repo, branch } = req.params;
    
    // Use the cached response if available
    const cacheKey = `branch:${owner}/${repo}:${branch}`;
    const cachedBranch = req.cache.get(cacheKey);
    
    if (cachedBranch) {
      return res.json(cachedBranch);
    }
    
    // Fetch branch from GitHub API
    const response = await req.octokit.rest.repos.getBranch({
      owner,
      repo,
      branch
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching branch:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Branch not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/branches/:owner/:repo
 * @desc    Create a new branch
 * @access  Private
 */
router.post('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { name, sha } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    if (!sha) {
      return res.status(400).json({ error: 'SHA reference is required' });
    }
    
    // Create a reference (branch) through GitHub API
    const response = await req.octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${name}`,
      sha
    });
    
    // Invalidate cache for branches list
    const cachePattern = new RegExp(`^branches:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error('Error creating branch:', error);
    
    // Handle specific error cases with better messages
    if (error.status === 422) {
      return res.status(422).json({ error: 'Branch already exists or invalid SHA reference' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   DELETE /api/branches/:owner/:repo/:branch
 * @desc    Delete a branch
 * @access  Private
 */
router.delete('/:owner/:repo/:branch', async (req, res) => {
  try {
    const { owner, repo, branch } = req.params;
    
    // Delete reference (branch) through GitHub API
    await req.octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });
    
    // Invalidate caches
    req.cache.del(`branch:${owner}/${repo}:${branch}`);
    
    const cachePattern = new RegExp(`^branches:${owner}/${repo}`);
    req.cache.keys().forEach(key => {
      if (cachePattern.test(key)) {
        req.cache.del(key);
      }
    });
    
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting branch:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Branch not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/branches/:owner/:repo/:branch/protection
 * @desc    Get branch protection
 * @access  Private
 */
router.get('/:owner/:repo/:branch/protection', async (req, res) => {
  try {
    const { owner, repo, branch } = req.params;
    
    // Use the cached response if available
    const cacheKey = `branch:${owner}/${repo}:${branch}:protection`;
    const cachedProtection = req.cache.get(cacheKey);
    
    if (cachedProtection) {
      return res.json(cachedProtection);
    }
    
    // Fetch branch protection from GitHub API
    const response = await req.octokit.rest.repos.getBranchProtection({
      owner,
      repo,
      branch
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching branch protection:', error);
    
    // Handle specific error cases with better messages
    if (error.status === 404) {
      return res.status(404).json({ error: 'Branch protection not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   PUT /api/branches/:owner/:repo/:branch/protection
 * @desc    Update branch protection
 * @access  Private
 */
router.put('/:owner/:repo/:branch/protection', async (req, res) => {
  try {
    const { owner, repo, branch } = req.params;
    const { 
      required_status_checks,
      enforce_admins,
      required_pull_request_reviews,
      restrictions,
      required_linear_history,
      allow_force_pushes,
      allow_deletions
    } = req.body;
    
    // Update branch protection through GitHub API
    const response = await req.octokit.rest.repos.updateBranchProtection({
      owner,
      repo,
      branch,
      required_status_checks,
      enforce_admins,
      required_pull_request_reviews,
      restrictions,
      required_linear_history,
      allow_force_pushes,
      allow_deletions
    });
    
    // Invalidate cache
    req.cache.del(`branch:${owner}/${repo}:${branch}:protection`);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error updating branch protection:', error);
    
    // Handle specific error cases with better messages
    if (error.status === 404) {
      return res.status(404).json({ error: 'Branch not found' });
    } else if (error.status === 403) {
      return res.status(403).json({ error: 'Not authorized to update branch protection' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   DELETE /api/branches/:owner/:repo/:branch/protection
 * @desc    Remove branch protection
 * @access  Private
 */
router.delete('/:owner/:repo/:branch/protection', async (req, res) => {
  try {
    const { owner, repo, branch } = req.params;
    
    // Remove branch protection through GitHub API
    await req.octokit.rest.repos.deleteBranchProtection({
      owner,
      repo,
      branch
    });
    
    // Invalidate cache
    req.cache.del(`branch:${owner}/${repo}:${branch}:protection`);
    
    res.status(204).end();
  } catch (error) {
    console.error('Error removing branch protection:', error);
    
    // Handle specific error cases with better messages
    if (error.status === 404) {
      return res.status(404).json({ error: 'Branch protection not found' });
    } else if (error.status === 403) {
      return res.status(403).json({ error: 'Not authorized to remove branch protection' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 