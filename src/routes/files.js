const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/files/:owner/:repo/contents/:path
 * @desc    Get contents of a file or directory
 * @access  Private
 */
router.get('/:owner/:repo/contents/:path(*)', async (req, res) => {
  try {
    const { owner, repo, path } = req.params;
    const branch = req.query.branch || 'main';
    
    // Use the cached response if available
    const cacheKey = `file:${owner}/${repo}/${path}@${branch}`;
    const cachedContent = req.cache.get(cacheKey);
    
    if (cachedContent) {
      return res.json(cachedContent);
    }
    
    // Fetch file or directory contents from GitHub API
    const response = await req.octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching file contents:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'File or directory not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   PUT /api/files/:owner/:repo/contents/:path
 * @desc    Create or update a file
 * @access  Private
 */
router.put('/:owner/:repo/contents/:path(*)', async (req, res) => {
  try {
    const { owner, repo, path } = req.params;
    const { content, message, branch, sha } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'File content is required' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'Commit message is required' });
    }
    
    // Convert content to base64 if it's not already
    const contentEncoded = Buffer.from(content).toString('base64');
    
    // Create or update file through GitHub API
    const response = await req.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: contentEncoded,
      branch: branch || 'main',
      sha: sha // Required for updating existing files
    });
    
    // Invalidate cache
    const cacheKey = `file:${owner}/${repo}/${path}@${branch || 'main'}`;
    req.cache.del(cacheKey);
    
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error creating or updating file:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   DELETE /api/files/:owner/:repo/contents/:path
 * @desc    Delete a file
 * @access  Private
 */
router.delete('/:owner/:repo/contents/:path(*)', async (req, res) => {
  try {
    const { owner, repo, path } = req.params;
    const { message, branch, sha } = req.body;
    
    if (!sha) {
      return res.status(400).json({ error: 'File SHA is required' });
    }
    
    // Delete file through GitHub API
    await req.octokit.rest.repos.deleteFile({
      owner,
      repo,
      path,
      message: message || `Delete ${path}`,
      sha,
      branch: branch || 'main'
    });
    
    // Invalidate cache
    const cacheKey = `file:${owner}/${repo}/${path}@${branch || 'main'}`;
    req.cache.del(cacheKey);
    
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/files/:owner/:repo/raw/:path
 * @desc    Get raw content of a file
 * @access  Private
 */
router.get('/:owner/:repo/raw/:path(*)', async (req, res) => {
  try {
    const { owner, repo, path } = req.params;
    const branch = req.query.branch || 'main';
    
    // Fetch file contents from GitHub API
    const response = await req.octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch
    });
    
    // Ensure the response is a file, not a directory
    if (Array.isArray(response.data)) {
      return res.status(400).json({ error: 'Path refers to a directory, not a file' });
    }
    
    // Decode the content if it's base64 encoded
    let content;
    if (response.data.encoding === 'base64') {
      content = Buffer.from(response.data.content, 'base64').toString('utf8');
    } else {
      content = response.data.content;
    }
    
    // Set appropriate content type
    const fileExtension = path.split('.').pop().toLowerCase();
    let contentType = 'text/plain';
    
    // Map common file extensions to content types
    const contentTypes = {
      'html': 'text/html',
      'htm': 'text/html',
      'js': 'application/javascript',
      'css': 'text/css',
      'json': 'application/json',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'xml': 'application/xml',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf'
    };
    
    if (contentTypes[fileExtension]) {
      contentType = contentTypes[fileExtension];
    }
    
    res.set('Content-Type', contentType);
    res.send(content);
  } catch (error) {
    console.error('Error fetching raw file content:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/files/:owner/:repo/blob/:sha
 * @desc    Get contents of a git blob by SHA
 * @access  Private
 */
router.get('/:owner/:repo/blob/:sha', async (req, res) => {
  try {
    const { owner, repo, sha } = req.params;
    
    // Use cached response if available
    const cacheKey = `blob:${owner}/${repo}/${sha}`;
    const cachedBlob = req.cache.get(cacheKey);
    
    if (cachedBlob) {
      return res.json(cachedBlob);
    }
    
    // Fetch blob from GitHub API
    const response = await req.octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: sha
    });
    
    // Cache the response
    req.cache.set(cacheKey, response.data);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching git blob:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Git blob not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 