const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { askGemini } = require('../utils/gemini');

const router = express.Router();

// ============================================================
// GET /api/ai/settings  (Admin) - view the mentor's global instructions
// ============================================================
router.get('/settings', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ai_settings WHERE id = 1 LIMIT 1');
    res.json(rows[0] || {});
  } catch (error) {
    res.status(500).json({ error: 'Could not load AI mentor settings.' });
  }
});

// ============================================================
// PUT /api/ai/settings  (Admin) - this prompt applies to every trainee's AI mentor
// ============================================================
router.put('/settings', verifyToken, requireRole('Admin'), async (req, res) => {
  const { mentor_name, system_prompt, model, mode } = req.body;
  if (!system_prompt || !system_prompt.trim()) {
    return res.status(400).json({ error: 'Please write instructions for the AI mentor.' });
  }
  if (mode && !['gem_link', 'api_chat'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode.' });
  }

  try {
    await db.query(
      `UPDATE ai_settings SET mentor_name = ?, system_prompt = ?, model = ?, mode = ?, updated_by = ? WHERE id = 1`,
      [
        mentor_name || 'AI Learning Mentor',
        system_prompt.trim(),
        model || 'gemini-flash-latest',
        mode || 'gem_link',
        req.user.id
      ]
    );
    res.json({ message: 'AI mentor settings saved. This now applies to every trainee.' });
  } catch (error) {
    console.error('Update AI settings error:', error);
    res.status(500).json({ error: 'Could not save AI mentor settings.' });
  }
});

// ============================================================
// GET /api/ai/mentor-info  (Trainee) - which mode is active, and
// (if manual mode) their own assigned Gemini Gem link
// ============================================================
router.get('/mentor-info', verifyToken, requireRole('Trainee'), async (req, res) => {
  try {
    const [[settings]] = await db.query('SELECT mentor_name, mode FROM ai_settings WHERE id = 1 LIMIT 1');
    const [[me]] = await db.query('SELECT gem_link FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    res.json({
      mentor_name: settings?.mentor_name || 'AI Learning Mentor',
      mode: settings?.mode || 'gem_link',
      gem_link: me?.gem_link || null
    });
  } catch (error) {
    res.status(500).json({ error: 'Could not load AI mentor info.' });
  }
});

// ============================================================
// GET /api/ai/history  (Trainee) - my conversation so far
// ============================================================
router.get('/history', verifyToken, requireRole('Trainee'), async (req, res) => {
  try {
    const [convRows] = await db.query(
      'SELECT conversation_id FROM ai_conversations WHERE trainee_id = ? ORDER BY started_at DESC LIMIT 1',
      [req.user.id]
    );
    if (convRows.length === 0) return res.json({ messages: [] });

    const [messages] = await db.query(
      'SELECT sender, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY message_id ASC',
      [convRows[0].conversation_id]
    );
    res.json({ messages });
  } catch (error) {
    console.error('AI history error:', error);
    res.status(500).json({ error: 'Could not load conversation history.' });
  }
});

// ============================================================
// POST /api/ai/chat  (Trainee) - send a message, get the mentor's reply
// ============================================================
router.post('/chat', verifyToken, requireRole('Trainee'), async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Please write a message.' });
  }

  try {
    // Get (or create) this trainee's ongoing conversation
    let [convRows] = await db.query(
      'SELECT conversation_id FROM ai_conversations WHERE trainee_id = ? ORDER BY started_at DESC LIMIT 1',
      [req.user.id]
    );
    let conversationId;
    if (convRows.length === 0) {
      const [created] = await db.query('INSERT INTO ai_conversations (trainee_id) VALUES (?)', [req.user.id]);
      conversationId = created.insertId;
    } else {
      conversationId = convRows[0].conversation_id;
    }

    // Save the trainee's message
    await db.query('INSERT INTO ai_messages (conversation_id, sender, content) VALUES (?, ?, ?)', [
      conversationId,
      'user',
      message.trim()
    ]);

    // Build the full system prompt: admin's global instructions + this trainee's profile
    const [[aiSettings]] = await db.query('SELECT * FROM ai_settings WHERE id = 1 LIMIT 1');
    const [[trainee]] = await db.query(
      `SELECT u.name, u.department, u.learning_style, s.name AS supervisor_name
       FROM users u LEFT JOIN users s ON u.supervisor_id = s.id WHERE u.id = ?`,
      [req.user.id]
    );

    const systemPrompt = `${aiSettings?.system_prompt || 'You are a corporate training mentor.'}

You are mentoring this specific employee right now:
- Name: ${trainee?.name || 'Employee'}
- Department: ${trainee?.department || 'Not specified'}
- Learning style: ${trainee?.learning_style || 'Not assessed'}
- Supervisor: ${trainee?.supervisor_name || 'Not assigned'}

Adapt your explanations to their learning style when possible. Keep a respectful, professional, encouraging tone. Never invent company policy you don't know; suggest they confirm with their supervisor when unsure.`;

    // Pull the last 20 messages (this one included) for conversation context
    const [historyRows] = await db.query(
      'SELECT sender, content FROM ai_messages WHERE conversation_id = ? ORDER BY message_id DESC LIMIT 20',
      [conversationId]
    );
    const history = historyRows.reverse();

    process.env.GEMINI_MODEL = aiSettings?.model || process.env.GEMINI_MODEL;
    const replyText = await askGemini(systemPrompt, history);

    await db.query('INSERT INTO ai_messages (conversation_id, sender, content) VALUES (?, ?, ?)', [
      conversationId,
      'ai',
      replyText
    ]);

    res.json({ reply: replyText });
  } catch (error) {
    console.error('AI chat error:', error.message);
    res.status(500).json({ error: error.message || 'The AI mentor is unavailable right now.' });
  }
});

module.exports = router;
