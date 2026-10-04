const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const app = express();

// ------------------------------------------------------------
// Middleware
// ------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({ status: 'success', message: 'Enterprise LMS Backend API', version: '1.0.0' });
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/users.routes'));
app.use('/api/courses', require('./routes/courses.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/reports', require('./routes/reports.routes'));
app.use('/api/ai', require('./routes/ai.routes'));
app.use('/api/quiz', require('./routes/quiz.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/public', require('./routes/public.routes'));

// ------------------------------------------------------------
// 404 + error handling
// ------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: `No endpoint at ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Enterprise LMS API running on port ${PORT}`);
});
