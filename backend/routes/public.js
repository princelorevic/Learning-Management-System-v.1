const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

// No authenticate/authorize middleware on purpose — this is the public marketing site.
router.get('/stats', publicController.getStats);

module.exports = router;