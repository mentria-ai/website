const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/repositories
 * @desc    Get repositories for the authenticated user
 * @access  Private
 */
router.get('/', async (req, res) => {
  try {
    const { page = 1, per_page = 30 } = req.query;
    
    const response = await req.octokit.rest.repos.listForAuthenticatedUser({
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
    
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
    
    const response = await req.octokit.rest.repos.get({
      owner,
      repo
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching repository ${req.params.owner}/${req.params.repo}:`, error);
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
    const { 
      name, 
      description = '', 
      private: isPrivate = false, 
      auto_init: autoInit = true,
      gitignore_template: gitignoreTemplate = null,
      license_template: licenseTemplate = null
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    const response = await req.octokit.rest.repos.createForAuthenticatedUser({
      name,
      description,
      private: isPrivate,
      auto_init: autoInit,
      gitignore_template: gitignoreTemplate,
      license_template: licenseTemplate
    });
    
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
    
    await req.octokit.rest.repos.delete({
      owner,
      repo
    });
    
    res.status(204).send();
  } catch (error) {
    console.error(`Error deleting repository ${req.params.owner}/${req.params.repo}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/repositories/:owner/:repo/branches
 * @desc    Get branches for a repository
 * @access  Private
 */
router.get('/:owner/:repo/branches', async (req, res) => {
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
 * @route   GET /api/repositories/:owner/:repo/contributors
 * @desc    Get contributors for a repository
 * @access  Private
 */
router.get('/:owner/:repo/contributors', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    const response = await req.octokit.rest.repos.listContributors({
      owner,
      repo,
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching contributors for ${req.params.owner}/${req.params.repo}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 