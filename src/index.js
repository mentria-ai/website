require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Octokit } = require('@octokit/rest');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const cookieParser = require('cookie-parser');
const http = require('http');
const path = require('path');

// Import routes
const mcpRoutes = require('./routes/mcp');
const apiRoutes = require('./routes/api');
const { router: dashboardRouter, initDashboardRouter } = require('./routes/dashboard');

// Import services
const { initWebSocketService } = require('./services/websocketService');
const { initDashboardController } = require('./controllers/dashboardController');

// Environment variables
const PORT = process.env.PORT || 8765;
const HOST = process.env.HOST || 'localhost';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || '/mcp';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Server start time for uptime tracking
const serverStartTime = Date.now();

// Initialize Octokit with GitHub token
const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  userAgent: 'GitHub MCP Server v1.0.0'
});

// Initialize cache
const cache = new NodeCache({
  stdTTL: 300, // 5 minutes
  checkperiod: 60, // 1 minute
  useClones: false
});

// Initialize dashboard controller
const dashboardController = initDashboardController(cache, serverStartTime);

// Initialize WebSocket service
const wsService = initWebSocketService(server, octokit);

// Initialize dashboard router
initDashboardRouter(dashboardController);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging middleware
if (LOG_LEVEL !== 'none') {
  app.use(morgan(LOG_LEVEL === 'verbose' ? 'dev' : 'combined'));
}

// Rate limiting middleware (only for API routes)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

app.use('/api', apiLimiter);

// Request tracking middleware for dashboard stats
app.use((req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(body) {
    const endpoint = req.originalUrl.split('?')[0];
    dashboardController.trackRequest(endpoint, res.statusCode);
    return originalSend.call(this, body);
  };
  
  next();
});

// Static files for dashboard
app.use('/dashboard', express.static(path.join(process.cwd(), 'public', 'dashboard')));

// Routes
app.use(MCP_ENDPOINT, mcpRoutes(octokit, cache, wsService));
app.use('/api', apiRoutes(octokit, cache));
app.use('/dashboard', dashboardRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    endpoints: {
      mcp: MCP_ENDPOINT,
      api: '/api',
      dashboard: '/dashboard'
    }
  });
});

// MCP info endpoint
app.get('/mcp/info', (req, res) => {
  const serverUrl = process.env.PUBLIC_URL || `http://${HOST}:${PORT}`;
  
  res.json({
    name: 'GitHub MCP Server',
    version: '1.0.0',
    endpoint: `${serverUrl}${MCP_ENDPOINT}`,
    protocol: 'MCP',
    protocolVersion: process.env.MCP_VERSION || '1.0.0',
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`GitHub MCP Server running at http://${HOST}:${PORT}`);
  console.log(`MCP endpoint available at http://${HOST}:${PORT}${MCP_ENDPOINT}`);
  console.log(`Dashboard available at http://${HOST}:${PORT}/dashboard`);
}); 