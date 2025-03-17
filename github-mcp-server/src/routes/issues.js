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
    const { 
      state = 'open', 
      page = 1, 
      per_page = 30,
      sort = 'created',
      direction = 'desc'
    } = req.query;
    
    const response = await req.octokit.rest.issues.listForRepo({
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
    console.error(`Error fetching issues for ${req.params.owner}/${req.params.repo}:`, error);
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
    
    const response = await req.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: parseInt(issue_number)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching issue #${req.params.issue_number}:`, error);
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
    const { 
      title, 
      body = '', 
      assignees = [], 
      labels = [],
      milestone = null
    } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Issue title is required' });
    }
    
    const response = await req.octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      assignees,
      labels,
      milestone
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error(`Error creating issue in ${req.params.owner}/${req.params.repo}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   PATCH /api/issues/:owner/:repo/:issue_number
 * @desc    Update an existing issue
 * @access  Private
 */
router.patch('/:owner/:repo/:issue_number', async (req, res) => {
  try {
    const { owner, repo, issue_number } = req.params;
    const { 
      title, 
      body, 
      state, 
      assignees, 
      labels,
      milestone
    } = req.body;
    
    const updateParams = {
      owner,
      repo,
      issue_number: parseInt(issue_number)
    };
    
    // Only include params that are provided
    if (title !== undefined) updateParams.title = title;
    if (body !== undefined) updateParams.body = body;
    if (state !== undefined) updateParams.state = state;
    if (assignees !== undefined) updateParams.assignees = assignees;
    if (labels !== undefined) updateParams.labels = labels;
    if (milestone !== undefined) updateParams.milestone = milestone;
    
    const response = await req.octokit.rest.issues.update(updateParams);
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error updating issue #${req.params.issue_number}:`, error);
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
    
    const response = await req.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: parseInt(issue_number),
      body
    });
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error(`Error adding comment to issue #${req.params.issue_number}:`, error);
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
    
    const response = await req.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: parseInt(issue_number),
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching comments for issue #${req.params.issue_number}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 