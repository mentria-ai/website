const os = require('os');
const { v4: uuidv4 } = require('uuid');
const NodeCache = require('node-cache');

// To be initiated in index.js and passed to the controller
let cache;
let startTime;
let requestStats;
let connections;

/**
 * Initialize dashboard controller with shared resources
 */
const initDashboardController = (cacheInstance, serverStartTime) => {
  cache = cacheInstance;
  startTime = serverStartTime;
  requestStats = {
    total: 0,
    success: 0,
    error: 0,
    byEndpoint: {}
  };
  connections = new Map();
  
  return {
    getServerStats,
    getCacheStats,
    clearCache,
    getConnectionStats,
    trackRequest,
    getEndpointStats,
    resetStats
  };
};

/**
 * Get server statistics
 */
const getServerStats = (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000); // seconds
  
  const stats = {
    uptime,
    uptimeFormatted: formatUptime(uptime),
    memory: {
      total: Math.round(os.totalmem() / (1024 * 1024)), // MB
      free: Math.round(os.freemem() / (1024 * 1024)), // MB
      used: Math.round((os.totalmem() - os.freemem()) / (1024 * 1024)) // MB
    },
    cpu: os.loadavg()[0].toFixed(2), // 1 minute load average
    connections: connections.size,
    requests: {
      total: requestStats.total,
      success: requestStats.success,
      error: requestStats.error
    }
  };
  
  res.json(stats);
};

/**
 * Get cache statistics
 */
const getCacheStats = (req, res) => {
  if (!cache) {
    return res.status(500).json({ error: 'Cache not initialized' });
  }
  
  const stats = {
    keys: cache.keys().length,
    hits: cache.getStats().hits,
    misses: cache.getStats().misses,
    size: formatSize(cache.getStats().ksize),
    keys: cache.keys()
  };
  
  res.json(stats);
};

/**
 * Clear the cache
 */
const clearCache = (req, res) => {
  if (!cache) {
    return res.status(500).json({ error: 'Cache not initialized' });
  }
  
  cache.flushAll();
  
  res.json({ success: true, message: 'Cache cleared successfully' });
};

/**
 * Track active WebSocket connections
 */
const getConnectionStats = (req, res) => {
  const stats = {
    active: connections.size,
    connections: Array.from(connections.values()).map(conn => ({
      id: conn.id,
      ip: conn.ip,
      connectedAt: conn.connectedAt,
      lastActivity: conn.lastActivity
    }))
  };
  
  res.json(stats);
};

/**
 * Track a request for stats
 */
const trackRequest = (endpoint, statusCode) => {
  requestStats.total++;
  
  if (statusCode >= 200 && statusCode < 400) {
    requestStats.success++;
  } else {
    requestStats.error++;
  }
  
  if (!requestStats.byEndpoint[endpoint]) {
    requestStats.byEndpoint[endpoint] = {
      total: 0,
      success: 0,
      error: 0
    };
  }
  
  requestStats.byEndpoint[endpoint].total++;
  
  if (statusCode >= 200 && statusCode < 400) {
    requestStats.byEndpoint[endpoint].success++;
  } else {
    requestStats.byEndpoint[endpoint].error++;
  }
};

/**
 * Get endpoint request statistics
 */
const getEndpointStats = (req, res) => {
  res.json(requestStats.byEndpoint);
};

/**
 * Reset all statistics
 */
const resetStats = (req, res) => {
  requestStats = {
    total: 0,
    success: 0,
    error: 0,
    byEndpoint: {}
  };
  
  res.json({ success: true, message: 'Statistics reset successfully' });
};

/**
 * Add a new WebSocket connection
 */
const addConnection = (socket, ip) => {
  const connection = {
    id: uuidv4(),
    socket,
    ip,
    connectedAt: new Date(),
    lastActivity: new Date()
  };
  
  connections.set(socket, connection);
  return connection.id;
};

/**
 * Remove a WebSocket connection
 */
const removeConnection = (socket) => {
  connections.delete(socket);
};

/**
 * Update connection last activity time
 */
const updateConnectionActivity = (socket) => {
  if (connections.has(socket)) {
    connections.get(socket).lastActivity = new Date();
  }
};

// Helper functions
const formatUptime = (seconds) => {
  const days = Math.floor(seconds / (24 * 60 * 60));
  seconds %= (24 * 60 * 60);
  const hours = Math.floor(seconds / (60 * 60));
  seconds %= (60 * 60);
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  
  let result = '';
  if (days > 0) result += `${days}d `;
  if (hours > 0 || days > 0) result += `${hours}h `;
  if (minutes > 0 || hours > 0 || days > 0) result += `${minutes}m `;
  result += `${seconds}s`;
  
  return result;
};

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

module.exports = {
  initDashboardController,
  addConnection,
  removeConnection,
  updateConnectionActivity
}; 