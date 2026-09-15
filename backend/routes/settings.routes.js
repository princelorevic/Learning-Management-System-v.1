const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/settings  - PUBLIC (the login page needs branding too)
// ============================================================
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM system_settings');
    const settings = {};
    rows.forEach((row) => {
      settings[row.setting_key] = row.setting_value;
    });
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Could not load settings.' });
  }
});

// ============================================================
// PUT /api/settings  (Admin) - update company name / logo / brand color
// Tip: to fully replace the default logo image instead of linking one,
// just overwrite frontend/assets/images/logo.png and leave logo_url blank.
// ============================================================
router.put('/', verifyToken, requireRole('Admin'), async (req, res) => {
  const { company_name, logo_url, primary_color, assessment_form_url } = req.body;

  const updates = { company_name, logo_url, primary_color, assessment_form_url };

  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      await db.query(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = ?`,
        [key, value, value]
      );
    }
    res.json({ message: 'Settings saved.' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

module.exports = router;
