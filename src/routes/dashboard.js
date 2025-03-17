const express = require('express');
const router = express.Router();
const { verifyDashboardAuth, verifyDashboardLogin } = require('../middleware/authMiddleware');
const path = require('path');
const fs = require('fs');

// These functions will be initialized in index.js and passed to this router
let dashboardController;

/**
 * Initialize the dashboard router with the dashboard controller
 */
const initDashboardRouter = (controller) => {
  dashboardController = controller;
  return router;
};

// Authentication routes
router.post('/auth/login', verifyDashboardLogin);
router.post('/auth/logout', (req, res) => {
  res.clearCookie('jwt');
  res.json({ success: true });
});

// Secured dashboard API routes (require authentication)
router.use('/api', verifyDashboardAuth);

// Server stats
router.get('/api/stats/server', (req, res) => {
  dashboardController.getServerStats(req, res);
});

// Cache stats and management
router.get('/api/stats/cache', (req, res) => {
  dashboardController.getCacheStats(req, res);
});
router.post('/api/cache/clear', (req, res) => {
  dashboardController.clearCache(req, res);
});

// Connection stats
router.get('/api/stats/connections', (req, res) => {
  dashboardController.getConnectionStats(req, res);
});

// Endpoint stats
router.get('/api/stats/endpoints', (req, res) => {
  dashboardController.getEndpointStats(req, res);
});

// Reset stats
router.post('/api/stats/reset', (req, res) => {
  dashboardController.resetStats(req, res);
});

// Integration information
router.get('/api/integration/info', (req, res) => {
  const serverUrl = process.env.PUBLIC_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 8765}`;
  
  res.json({
    mcpEndpoint: `${serverUrl}${process.env.MCP_ENDPOINT || '/mcp'}`,
    mcpVersion: process.env.MCP_VERSION || '1.0.0',
    serverName: 'GitHub MCP Server',
    features: [
      'GitHub API integration',
      'Repository management',
      'File operations',
      'Issue tracking',
      'Pull request management',
      'GitHub Actions integration',
      'Real-time updates (WebSocket)',
      'Search capabilities'
    ]
  });
});

// Environment information (excluding sensitive data)
router.get('/api/environment', (req, res) => {
  res.json({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    serverPort: process.env.PORT || 8765,
    serverHost: process.env.HOST || 'localhost',
    publicUrl: process.env.PUBLIC_URL || `http://${process.env.HOST || 'localhost'}:${process.env.PORT || 8765}`,
    mcpEndpoint: process.env.MCP_ENDPOINT || '/mcp',
    mcpVersion: process.env.MCP_VERSION || '1.0.0'
  });
});

// Serve the main dashboard page for all other routes
router.get('*', verifyDashboardAuth, (req, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'dashboard', 'index.html');
  
  // Check if the file exists
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Dashboard not found' });
  }
});

module.exports = {
  router,
  initDashboardRouter
}; 