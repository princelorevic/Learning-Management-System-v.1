// ============================================================
// Auth middleware
//   verifyToken   - confirms the request carries a valid login
//                   token and attaches the user to req.user
//   requireRole   - confirms req.user has one of the allowed roles
// ============================================================
const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Not logged in. Please sign in again.' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }
    req.user = decoded; // { id, name, role, username }
    next();
  });
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
