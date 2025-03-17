const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/workflows/:owner/:repo
 * @desc    Get all workflows for a repository
 * @access  Private
 */
router.get('/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `workflows:${owner}/${repo}:${page}:${per_page}`;
    const cachedWorkflows = req.cache.get(cacheKey);
    
    if (cachedWorkflows) {
      return res.json(cachedWorkflows);
    }
    
    // Fetch workflows from GitHub API
    const response = await req.octokit.rest.actions.listRepoWorkflows({
      owner,
      repo,
      page,
      per_page
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching workflows:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/workflows/:owner/:repo/:workflow_id
 * @desc    Get a specific workflow
 * @access  Private
 */
router.get('/:owner/:repo/:workflow_id', async (req, res) => {
  try {
    const { owner, repo, workflow_id } = req.params;
    
    // Use the cached response if available
    const cacheKey = `workflow:${owner}/${repo}:${workflow_id}`;
    const cachedWorkflow = req.cache.get(cacheKey);
    
    if (cachedWorkflow) {
      return res.json(cachedWorkflow);
    }
    
    // Fetch workflow from GitHub API
    const response = await req.octokit.rest.actions.getWorkflow({
      owner,
      repo,
      workflow_id
    });
    
    // Cache the response for 5 minutes
    req.cache.set(cacheKey, response.data, 300);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching workflow:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/workflows/:owner/:repo/:workflow_id/dispatches
 * @desc    Trigger a workflow run
 * @access  Private
 */
router.post('/:owner/:repo/:workflow_id/dispatches', async (req, res) => {
  try {
    const { owner, repo, workflow_id } = req.params;
    const { ref, inputs } = req.body;
    
    if (!ref) {
      return res.status(400).json({ error: 'Git reference (branch or tag) is required' });
    }
    
    // Trigger workflow through GitHub API
    await req.octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id,
      ref,
      inputs
    });
    
    // GitHub doesn't return a response body for this endpoint
    res.status(204).end();
  } catch (error) {
    console.error('Error triggering workflow:', error);
    
    // Handle specific error cases with better messages
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow not found' });
    } else if (error.status === 422) {
      return res.status(422).json({ error: 'Reference or inputs are invalid' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/workflows/:owner/:repo/:workflow_id/runs
 * @desc    Get workflow runs
 * @access  Private
 */
router.get('/:owner/:repo/:workflow_id/runs', async (req, res) => {
  try {
    const { owner, repo, workflow_id } = req.params;
    const { 
      branch, 
      event, 
      status, 
      created, 
      page = 1, 
      per_page = 30 
    } = req.query;
    
    // Use the cached response if available
    const cacheKey = `workflow:${owner}/${repo}:${workflow_id}:runs:${branch || ''}:${event || ''}:${status || ''}:${created || ''}:${page}:${per_page}`;
    const cachedRuns = req.cache.get(cacheKey);
    
    if (cachedRuns) {
      return res.json(cachedRuns);
    }
    
    // Fetch workflow runs from GitHub API
    const response = await req.octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id,
      branch,
      event,
      status,
      created,
      page,
      per_page
    });
    
    // Cache the response for 2 minutes (runs change frequently)
    req.cache.set(cacheKey, response.data, 120);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching workflow runs:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/workflows/:owner/:repo/runs/:run_id
 * @desc    Get a specific workflow run
 * @access  Private
 */
router.get('/:owner/:repo/runs/:run_id', async (req, res) => {
  try {
    const { owner, repo, run_id } = req.params;
    
    // Use the cached response if available
    const cacheKey = `workflow:${owner}/${repo}:run:${run_id}`;
    const cachedRun = req.cache.get(cacheKey);
    
    if (cachedRun) {
      return res.json(cachedRun);
    }
    
    // Fetch workflow run from GitHub API
    const response = await req.octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id
    });
    
    // Cache the response for 1 minute (runs change frequently)
    req.cache.set(cacheKey, response.data, 60);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching workflow run:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/workflows/:owner/:repo/runs/:run_id/cancel
 * @desc    Cancel a workflow run
 * @access  Private
 */
router.post('/:owner/:repo/runs/:run_id/cancel', async (req, res) => {
  try {
    const { owner, repo, run_id } = req.params;
    
    // Cancel workflow run through GitHub API
    await req.octokit.rest.actions.cancelWorkflowRun({
      owner,
      repo,
      run_id
    });
    
    // Invalidate cache
    req.cache.del(`workflow:${owner}/${repo}:run:${run_id}`);
    
    // GitHub doesn't return a response body for this endpoint
    res.status(204).end();
  } catch (error) {
    console.error('Error cancelling workflow run:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/workflows/:owner/:repo/runs/:run_id/rerun
 * @desc    Rerun a workflow run
 * @access  Private
 */
router.post('/:owner/:repo/runs/:run_id/rerun', async (req, res) => {
  try {
    const { owner, repo, run_id } = req.params;
    
    // Rerun workflow run through GitHub API
    await req.octokit.rest.actions.reRunWorkflow({
      owner,
      repo,
      run_id
    });
    
    // Invalidate cache
    req.cache.del(`workflow:${owner}/${repo}:run:${run_id}`);
    
    // GitHub doesn't return a response body for this endpoint
    res.status(204).end();
  } catch (error) {
    console.error('Error rerunning workflow run:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/workflows/:owner/:repo/runs/:run_id/logs
 * @desc    Get logs for a workflow run
 * @access  Private
 */
router.get('/:owner/:repo/runs/:run_id/logs', async (req, res) => {
  try {
    const { owner, repo, run_id } = req.params;
    
    // Fetch workflow run logs from GitHub API
    // This returns a redirect URL to download the logs
    const response = await req.octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id
    });
    
    // Redirect to the logs URL
    res.redirect(response.url);
  } catch (error) {
    console.error('Error fetching workflow run logs:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow run logs not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/workflows/:owner/:repo/runs/:run_id/jobs
 * @desc    Get jobs for a workflow run
 * @access  Private
 */
router.get('/:owner/:repo/runs/:run_id/jobs', async (req, res) => {
  try {
    const { owner, repo, run_id } = req.params;
    const { filter = 'latest', page = 1, per_page = 30 } = req.query;
    
    // Use the cached response if available
    const cacheKey = `workflow:${owner}/${repo}:run:${run_id}:jobs:${filter}:${page}:${per_page}`;
    const cachedJobs = req.cache.get(cacheKey);
    
    if (cachedJobs) {
      return res.json(cachedJobs);
    }
    
    // Fetch workflow run jobs from GitHub API
    const response = await req.octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id,
      filter,
      page,
      per_page
    });
    
    // Cache the response for 1 minute (jobs change frequently)
    req.cache.set(cacheKey, response.data, 60);
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching workflow run jobs:', error);
    
    // Handle "not found" error with better message
    if (error.status === 404) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 