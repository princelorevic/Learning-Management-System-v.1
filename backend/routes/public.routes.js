const express = require('express');
const db = require('../config/db');

const router = express.Router();

// ============================================================
// GET /api/public/stats  — PUBLIC, no login required.
// Aggregate counts only (no names, no personal data) — safe to
// show on a public landing page.
// ============================================================
router.get('/stats', async (req, res) => {
  try {
    const [[stats]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users u INNER JOIN roles r ON u.role_id = r.role_id WHERE r.role_name = 'Trainee') AS total_trainees,
        (SELECT COUNT(*) FROM courses WHERE status = 'Published') AS total_trainings,
        (SELECT COUNT(*) FROM enrollments WHERE status = 'Completed') AS total_completions
    `);
    res.json(stats);
  } catch (error) {
    console.error('Public stats error:', error);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

module.exports = router;