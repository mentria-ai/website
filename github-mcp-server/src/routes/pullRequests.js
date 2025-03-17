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
    const { 
      state = 'open', 
      page = 1, 
      per_page = 30,
      sort = 'created',
      direction = 'desc'
    } = req.query;
    
    const response = await req.octokit.rest.pulls.list({
      owner,
      repo,
      state,
      page: parseInt(page),
      per_page: parseInt(per_page),
      sort,
      direction
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching pull requests for ${req.params.owner}/${req.params.repo}:`, error);
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
    
    const response = await req.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: parseInt(pull_number)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching pull request #${req.params.pull_number}:`, error);
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
    const { 
      title, 
      body = '', 
      head, 
      base = 'main',
      draft = false,
      maintainer_can_modify = true
    } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Pull request title is required' });
    }
    
    if (!head) {
      return res.status(400).json({ error: 'Source branch (head) is required' });
    }
    
    const response = await req.octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
      draft,
      maintainer_can_modify
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error(`Error creating pull request in ${req.params.owner}/${req.params.repo}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   PATCH /api/pull-requests/:owner/:repo/:pull_number
 * @desc    Update an existing pull request
 * @access  Private
 */
router.patch('/:owner/:repo/:pull_number', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { 
      title, 
      body, 
      state,
      base,
      maintainer_can_modify
    } = req.body;
    
    const updateParams = {
      owner,
      repo,
      pull_number: parseInt(pull_number)
    };
    
    // Only include params that are provided
    if (title !== undefined) updateParams.title = title;
    if (body !== undefined) updateParams.body = body;
    if (state !== undefined) updateParams.state = state;
    if (base !== undefined) updateParams.base = base;
    if (maintainer_can_modify !== undefined) updateParams.maintainer_can_modify = maintainer_can_modify;
    
    const response = await req.octokit.rest.pulls.update(updateParams);
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error updating pull request #${req.params.pull_number}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/pull-requests/:owner/:repo/:pull_number/files
 * @desc    Get files in a pull request
 * @access  Private
 */
router.get('/:owner/:repo/:pull_number/files', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    const response = await req.octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching files for pull request #${req.params.pull_number}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/pull-requests/:owner/:repo/:pull_number/comments
 * @desc    Add a review comment to a pull request
 * @access  Private
 */
router.post('/:owner/:repo/:pull_number/comments', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { body, commit_id, path, position } = req.body;
    
    if (!body) {
      return res.status(400).json({ error: 'Comment body is required' });
    }
    
    if (!commit_id || !path || position === undefined) {
      // If we're not adding a review comment on a specific line, add a regular comment
      const response = await req.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: parseInt(pull_number),
        body
      });
      
      return res.status(201).json(response.data);
    }
    
    // Add a review comment on a specific line
    const response = await req.octokit.rest.pulls.createReviewComment({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      body,
      commit_id,
      path,
      position
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error(`Error adding comment to pull request #${req.params.pull_number}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/pull-requests/:owner/:repo/:pull_number/comments
 * @desc    Get comments for a pull request
 * @access  Private
 */
router.get('/:owner/:repo/:pull_number/comments', async (req, res) => {
  try {
    const { owner, repo, pull_number } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    const response = await req.octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: parseInt(pull_number),
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching comments for pull request #${req.params.pull_number}:`, error);
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
    const { 
      merge_method = 'merge', 
      commit_title, 
      commit_message 
    } = req.body;
    
    const mergeParams = {
      owner,
      repo,
      pull_number: parseInt(pull_number),
      merge_method
    };
    
    if (commit_title) mergeParams.commit_title = commit_title;
    if (commit_message) mergeParams.commit_message = commit_message;
    
    const response = await req.octokit.rest.pulls.merge(mergeParams);
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error merging pull request #${req.params.pull_number}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 