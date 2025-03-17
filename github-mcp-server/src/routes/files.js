const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/files/:owner/:repo/:path*
 * @desc    Get file or directory contents
 * @access  Private
 */
router.get('/:owner/:repo/:path(*)', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const path = req.params.path || '';
    const branch = req.query.branch;
    
    const response = await req.octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch
    });
    
    res.json(response.data);
  } catch (error) {
    console.error(`Error fetching contents for ${req.params.path}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/files/:owner/:repo/:path*
 * @desc    Create or update a file
 * @access  Private
 */
router.post('/:owner/:repo/:path(*)', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const path = req.params.path;
    const { content, message, branch, sha } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'File content is required' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Commit message is required' });
    }
    
    // Base64 encode the content if it's not already encoded
    const contentEncoded = Buffer.from(content).toString('base64');
    
    const params = {
      owner,
      repo,
      path,
      message,
      content: contentEncoded,
      branch
    };
    
    // Include SHA if updating an existing file
    if (sha) {
      params.sha = sha;
    }
    
    const response = await req.octokit.rest.repos.createOrUpdateFileContents(params);
    
    res.status(201).json(response.data);
  } catch (error) {
    console.error(`Error creating/updating file ${req.params.path}:`, error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   DELETE /api/files/:owner/:repo/:path*
 * @desc    Delete a file
 * @access  Private
 */
router.delete('/:owner/:repo/:path(*)', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const path = req.params.path;
    const { message, branch, sha } = req.body;
    
    if (!sha) {
      return res.status(400).json({ error: 'File SHA is required for deletion' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Commit message is required' });
    }
    
    const response = await req.octokit.rest.repos.deleteFile({
      owner,
      repo,
      path,
      message,
      sha,
      branch
    });
    
    res.status(200).json(response.data);
  } catch (error) {
    console.error(`Error deleting file ${req.params.path}:`, error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 