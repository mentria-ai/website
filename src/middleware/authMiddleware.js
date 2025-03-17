const jwt = require('jsonwebtoken');
const { JWT_SECRET, DASHBOARD_USERNAME, DASHBOARD_PASSWORD } = process.env;

/**
 * Middleware to verify JWT token for API routes
 */
const verifyToken = (req, res, next) => {
  const token = req.header('x-auth-token') || req.cookies?.jwt;
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

/**
 * Middleware to check dashboard login credentials
 */
const verifyDashboardLogin = (req, res, next) => {
  const { username, password } = req.body;
  
  if (username === DASHBOARD_USERNAME && password === DASHBOARD_PASSWORD) {
    // Create a session token
    const token = jwt.sign(
      { username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    // Set token as cookie
    res.cookie('jwt', token, {
      httpOnly: true,
      maxAge: 3600000, // 1 hour
      sameSite: 'strict'
    });
    
    return res.status(200).json({ success: true });
  }
  
  res.status(401).json({ error: 'Invalid credentials' });
};

/**
 * Middleware to verify dashboard authentication
 */
const verifyDashboardAuth = (req, res, next) => {
  const token = req.cookies?.jwt;
  
  if (!token) {
    return res.redirect('/dashboard/login.html');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    
    // Only admins can access dashboard
    if (decoded.role !== 'admin') {
      return res.redirect('/dashboard/login.html');
    }
    
    next();
  } catch (error) {
    res.redirect('/dashboard/login.html');
  }
};

module.exports = {
  verifyToken,
  verifyDashboardLogin,
  verifyDashboardAuth
}; 