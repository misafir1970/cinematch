const { query } = require('../config/database');

// Middleware: ensure user has completed onboarding (>= 10 ratings)
// Assumes `verifyToken` has already populated `req.user`
const requireOnboardingComplete = async (req, res, next) => {
  try {
    // If no authenticated user, pass through – other middleware will reject.
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { rows } = await query(
      'SELECT COUNT(*)::int AS count FROM user_ratings WHERE user_id = $1',
      [req.user.id]
    );

    const ratingCount = rows.length ? rows[0].count : 0;

    if (ratingCount < 10) {
      return res.status(403).json({
        success: false,
        error: 'Onboarding incomplete. Please rate at least 10 movies.',
        remaining: 10 - ratingCount
      });
    }

    // All good
    next();
  } catch (err) {
    console.error('Onboarding middleware error:', err);
    res.status(500).json({ success: false, error: 'Onboarding check failed' });
  }
};

module.exports = {
  requireOnboardingComplete
};