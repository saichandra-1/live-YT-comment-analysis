const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // For testing, make sure we have a dummy user in the database
    const [user] = await User.findOrCreate({
      where: { email: 'test@example.com' },
      defaults: {
        googleId: 'test-google-id',
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    req.user = user; // user.id now references a real DB row
    next();
    
    /* Original auth code - commented out for testing
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(401).json({ message: 'Invalid token.' });
    }

    req.user = user;
    next();
    */
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Failed to seed test user.' });
  }
};

module.exports = auth;