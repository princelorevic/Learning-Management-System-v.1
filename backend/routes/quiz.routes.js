const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/:moduleId', verifyToken, async (req, res) => {
  try {
    const [[module]] = await db.query(
      "SELECT module_id, title, pass_percent FROM course_modules WHERE module_id = ? AND module_type = 'quiz' LIMIT 1",
      [req.params.moduleId]
    );
    if (!module) return res.status(404).json({ error: 'Quiz not found.' });

    const [questions] = await db.query(
      'SELECT question_id, question_text, sort_order FROM quiz_questions WHERE module_id = ? ORDER BY sort_order ASC, question_id ASC',
      [req.params.moduleId]
    );

    const includeAnswers = req.user.role === 'Admin' || req.user.role === 'Supervisor';
    const choiceFields = includeAnswers
      ? 'choice_id, question_id, choice_text, is_correct, sort_order'
      : 'choice_id, question_id, choice_text, sort_order';

    for (const q of questions) {
      const [choices] = await db.query(
        `SELECT ${choiceFields} FROM quiz_choices WHERE question_id = ? ORDER BY sort_order ASC, choice_id ASC`,
        [q.question_id]
      );
      q.choices = choices;
    }

    let myLatestAttempt = null;
    if (req.user.role === 'Trainee') {
      const [attempts] = await db.query(
        `SELECT attempt_id, score, total_questions, passed, attempted_at
         FROM quiz_attempts WHERE module_id = ? AND user_id = ? ORDER BY attempted_at DESC LIMIT 1`,
        [req.params.moduleId, req.user.id]
      );
      myLatestAttempt = attempts[0] || null;
    }

    res.json({ ...module, questions, myLatestAttempt });
  } catch (error) {
    console.error('Get quiz error:', error);
    res.status(500).json({ error: 'Could not load quiz.' });
  }
});

router.post('/questions', verifyToken, requireRole('Admin'), async (req, res) => {
  const { module_id, question_text, sort_order, choices } = req.body;

  if (!module_id || !question_text || !question_text.trim()) {
    return res.status(400).json({ error: 'module_id and question_text are required.' });
  }
  if (!Array.isArray(choices) || choices.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 answer choices.' });
  }
  if (!choices.some((c) => c.is_correct)) {
    return res.status(400).json({ error: 'Mark at least one choice as correct.' });
  }

  try {
    const [qResult] = await db.query(
      'INSERT INTO quiz_questions (module_id, question_text, sort_order) VALUES (?, ?, ?)',
      [module_id, question_text.trim(), sort_order || 0]
    );
    const questionId = qResult.insertId;

    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      if (!c.text || !c.text.trim()) continue;
      await db.query(
        'INSERT INTO quiz_choices (question_id, choice_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
        [questionId, c.text.trim(), !!c.is_correct, i]
      );
    }

    res.status(201).json({ message: 'Question added.', questionId });
  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({ error: 'Could not add question.' });
  }
});

router.put('/questions/:id', verifyToken, requireRole('Admin'), async (req, res) => {
  const { question_text, choices } = req.body;

  if (!question_text || !question_text.trim()) {
    return res.status(400).json({ error: 'question_text is required.' });
  }
  if (!Array.isArray(choices) || choices.length < 2 || !choices.some((c) => c.is_correct)) {
    return res.status(400).json({ error: 'Provide at least 2 choices with one marked correct.' });
  }

  try {
    const [result] = await db.query('UPDATE quiz_questions SET question_text = ? WHERE question_id = ?', [
      question_text.trim(),
      req.params.id
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Question not found.' });

    await db.query('DELETE FROM quiz_choices WHERE question_id = ?', [req.params.id]);
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      if (!c.text || !c.text.trim()) continue;
      await db.query(
        'INSERT INTO quiz_choices (question_id, choice_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
        [req.params.id, c.text.trim(), !!c.is_correct, i]
      );
    }

    res.json({ message: 'Question updated.' });
  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({ error: 'Could not update question.' });
  }
});

router.delete('/questions/:id', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM quiz_questions WHERE question_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Question not found.' });
    res.json({ message: 'Question removed.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not remove question.' });
  }
});

router.post('/:moduleId/submit', verifyToken, requireRole('Trainee'), async (req, res) => {
  const { answers } = req.body;
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'answers object is required.' });
  }

  try {
    const [[module]] = await db.query(
      "SELECT module_id, pass_percent FROM course_modules WHERE module_id = ? AND module_type = 'quiz' LIMIT 1",
      [req.params.moduleId]
    );
    if (!module) return res.status(404).json({ error: 'Quiz not found.' });

    const [questions] = await db.query('SELECT question_id FROM quiz_questions WHERE module_id = ?', [
      req.params.moduleId
    ]);
    if (questions.length === 0) {
      return res.status(400).json({ error: 'This quiz has no questions yet.' });
    }

    let correctCount = 0;
    for (const q of questions) {
      const submittedChoiceId = answers[q.question_id];
      if (!submittedChoiceId) continue;
      const [[correctChoice]] = await db.query(
        'SELECT choice_id FROM quiz_choices WHERE question_id = ? AND is_correct = TRUE LIMIT 1',
        [q.question_id]
      );
      if (correctChoice && String(correctChoice.choice_id) === String(submittedChoiceId)) {
        correctCount++;
      }
    }

    const total = questions.length;
    const percent = Math.round((correctCount / total) * 100);
    const passed = percent >= module.pass_percent;

    await db.query(
      'INSERT INTO quiz_attempts (module_id, user_id, score, total_questions, passed) VALUES (?, ?, ?, ?, ?)',
      [req.params.moduleId, req.user.id, correctCount, total, passed]
    );

    res.json({ score: correctCount, total, percent, passed, pass_percent: module.pass_percent });
  } catch (error) {
    console.error('Submit quiz error:', error);
    res.status(500).json({ error: 'Could not submit quiz.' });
  }
});

router.get('/:moduleId/attempts', verifyToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  try {
    const [attempts] = await db.query(
      `SELECT qa.attempt_id, qa.score, qa.total_questions, qa.passed, qa.attempted_at, u.name AS trainee_name
       FROM quiz_attempts qa INNER JOIN users u ON qa.user_id = u.id
       WHERE qa.module_id = ? ORDER BY qa.attempted_at DESC`,
      [req.params.moduleId]
    );
    res.json(attempts);
  } catch (error) {
    res.status(500).json({ error: 'Could not load attempts.' });
  }
});

module.exports = router;