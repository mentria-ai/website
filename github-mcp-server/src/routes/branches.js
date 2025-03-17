const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/branches/:owner/:repo
 * @desc    Get branches for a repository
 * @access  Private
 */
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    const response = await req.octokit.rest.repos.listBranches({
      owner,
      repo,
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching branches for ${req.params.owner}/${req.params.repo}:`, error);
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
    
    const response = await req.octokit.rest.repos.getBranch({
      owner,
      repo,
      branch
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching branch ${req.params.branch}:`, error);
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
    const { branch, from_branch = 'main' } = req.body;
    
    if (!branch) {
      return res.status(400).json({ error: 'Branch name is required' });
    }
    
    // Get the SHA of the from_branch
    const refResponse = await req.octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${from_branch}`
    });
    
    const sha = refResponse.data.object.sha;
    
    // Create a new reference (branch)
    const response = await req.octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error(`Error creating branch in ${req.params.owner}/${req.params.repo}:`, error);
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
    
    await req.octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`
    });
    
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting branch ${req.params.branch}:`, error);
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
    
    const response = await req.octokit.rest.repos.getBranchProtection({
      owner,
      repo,
      branch
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching protection for branch ${req.params.branch}:`, error);
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
      required_status_checks = null,
      enforce_admins = false,
      required_pull_request_reviews = null,
      restrictions = null
    } = req.body;
    
    const response = await req.octokit.rest.repos.updateBranchProtection({
      owner,
      repo,
      branch,
      required_status_checks,
      enforce_admins,
      required_pull_request_reviews,
      restrictions
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error updating protection for branch ${req.params.branch}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 