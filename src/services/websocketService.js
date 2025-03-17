const WebSocket = require('ws');
const { addConnection, removeConnection, updateConnectionActivity } = require('../controllers/dashboardController');
const jwt = require('jsonwebtoken');

let wss;
let octokit;

/**
 * Initialize the WebSocket service
 * @param {object} server - HTTP server instance
 * @param {object} octokitInstance - Authenticated Octokit instance
 */
function initWebSocketService(server, octokitInstance) {
  octokit = octokitInstance;
  
  // Create WebSocket server
  wss = new WebSocket.Server({ server });
  
  wss.on('connection', handleConnection);
  
  console.log('WebSocket server initialized');
  
  return {
    getServer: () => wss,
    broadcast,
    notifySubscribers,
    subscribeToRepository
  };
}

/**
 * Handle new WebSocket connections
 * @param {object} ws - WebSocket connection
 * @param {object} req - HTTP request
 */
function handleConnection(ws, req) {
  const ip = req.socket.remoteAddress;
  const connectionId = addConnection(ws, ip);
  
  console.log(`WebSocket connection established: ${connectionId} from ${ip}`);
  
  // Set up message handler
  ws.on('message', (message) => handleMessage(ws, message));
  
  // Set up close handler
  ws.on('close', () => {
    console.log(`WebSocket connection closed: ${connectionId}`);
    removeConnection(ws);
  });
  
  // Set up error handler
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${connectionId}:`, error);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    connectionId,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Handle incoming WebSocket messages
 * @param {object} ws - WebSocket connection
 * @param {string} message - Message data
 */
function handleMessage(ws, message) {
  try {
    updateConnectionActivity(ws);
    
    const data = JSON.parse(message);
    
    // Validate message format
    if (!data.type) {
      return sendError(ws, 'Invalid message format');
    }
    
    // Handle different message types
    switch (data.type) {
      case 'auth':
        handleAuth(ws, data);
        break;
      case 'subscribe':
        handleSubscribe(ws, data);
        break;
      case 'ping':
        handlePing(ws);
        break;
      default:
        sendError(ws, `Unknown message type: ${data.type}`);
    }
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
    sendError(ws, 'Invalid message format or server error');
  }
}

/**
 * Handle authentication messages
 * @param {object} ws - WebSocket connection
 * @param {object} data - Message data
 */
function handleAuth(ws, data) {
  try {
    // Verify token
    const decoded = jwt.verify(data.token, process.env.JWT_SECRET);
    
    // Store user info on the connection
    ws.user = decoded;
    
    ws.send(JSON.stringify({
      type: 'auth',
      status: 'success',
      username: decoded.username
    }));
  } catch (error) {
    sendError(ws, 'Authentication failed');
  }
}

/**
 * Handle subscription messages
 * @param {object} ws - WebSocket connection
 * @param {object} data - Message data
 */
function handleSubscribe(ws, data) {
  // Ensure user is authenticated
  if (!ws.user) {
    return sendError(ws, 'Authentication required');
  }
  
  const { resource, owner, repo } = data;
  
  if (!resource || !owner || !repo) {
    return sendError(ws, 'Invalid subscription request');
  }
  
  // Store subscription on the connection
  if (!ws.subscriptions) {
    ws.subscriptions = new Set();
  }
  
  const subscriptionKey = `${resource}:${owner}/${repo}`;
  ws.subscriptions.add(subscriptionKey);
  
  console.log(`Client subscribed to ${subscriptionKey}`);
  
  ws.send(JSON.stringify({
    type: 'subscribe',
    status: 'success',
    resource,
    owner,
    repo
  }));
}

/**
 * Handle ping messages
 * @param {object} ws - WebSocket connection
 */
function handlePing(ws) {
  ws.send(JSON.stringify({
    type: 'pong',
    timestamp: new Date().toISOString()
  }));
}

/**
 * Send error message to client
 * @param {object} ws - WebSocket connection
 * @param {string} message - Error message
 */
function sendError(ws, message) {
  ws.send(JSON.stringify({
    type: 'error',
    message
  }));
}

/**
 * Broadcast message to all connected clients
 * @param {object} data - Message data
 */
function broadcast(data) {
  if (!wss) return;
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

/**
 * Notify subscribers of repository events
 * @param {string} resource - Resource type (e.g., 'repository', 'issue', 'pr')
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {object} data - Event data
 */
function notifySubscribers(resource, owner, repo, data) {
  if (!wss) return;
  
  const subscriptionKey = `${resource}:${owner}/${repo}`;
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && 
        client.subscriptions && 
        client.subscriptions.has(subscriptionKey)) {
      
      client.send(JSON.stringify({
        type: 'update',
        resource,
        owner,
        repo,
        data,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

/**
 * Subscribe to repository events
 * This could be expanded to use GitHub webhooks in a production environment
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 */
async function subscribeToRepository(owner, repo) {
  try {
    console.log(`Setting up subscription to ${owner}/${repo} events`);
    
    // In a real implementation, this would set up a GitHub webhook
    // For now, we'll just log the subscription
    
    return {
      success: true,
      message: `Successfully subscribed to ${owner}/${repo} events`
    };
  } catch (error) {
    console.error(`Error subscribing to repository ${owner}/${repo}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  initWebSocketService
}; 