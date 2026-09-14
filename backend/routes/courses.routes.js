const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/courses  - list trainings
// Admin: sees everything. Supervisor: published + ones they facilitate.
// Trainee: published only.
// ============================================================
router.get('/', verifyToken, async (req, res) => {
  try {
    const params = [];
    let where = '1=1';

    if (req.user.role === 'Trainee') {
      where = "c.status = 'Published'";
    } else if (req.user.role === 'Supervisor') {
      where = "(c.status = 'Published' OR c.created_by = ? OR cf.supervisor_id = ?)";
      params.push(req.user.id, req.user.id);
    }
    // Admin: no restriction

    const [rows] = await db.query(
      `SELECT DISTINCT c.course_id, c.title, c.description, c.department_target, c.status,
              c.duration_hours, c.created_by, c.created_at,
              u.name AS created_by_name,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.course_id) AS enrolled_count,
              (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.course_id AND e.status = 'Completed') AS completed_count
       FROM courses c
       LEFT JOIN users u ON c.created_by = u.id
       LEFT JOIN course_facilitators cf ON cf.course_id = c.course_id
       WHERE ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (error) {
    console.error('List courses error:', error);
    res.status(500).json({ error: 'Could not load trainings.' });
  }
});

// ============================================================
// GET /api/courses/mine  (Trainee) - my enrollments with progress
// ============================================================
router.get('/mine', verifyToken, requireRole('Trainee'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.enrollment_id, e.status, e.progress, e.enrolled_at, e.completed_at,
              c.course_id, c.title, c.description, c.duration_hours
       FROM enrollments e
       INNER JOIN courses c ON e.course_id = c.course_id
       WHERE e.user_id = ?
       ORDER BY e.enrolled_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('My enrollments error:', error);
    res.status(500).json({ error: 'Could not load your trainings.' });
  }
});

// ============================================================
// GET /api/courses/:id  - training detail + modules + facilitators
// ============================================================
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [courseRows] = await db.query('SELECT * FROM courses WHERE course_id = ? LIMIT 1', [req.params.id]);
    if (courseRows.length === 0) return res.status(404).json({ error: 'Training not found.' });

    const [modules] = await db.query(
      'SELECT module_id, title, content, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, module_id ASC',
      [req.params.id]
    );
    const [facilitators] = await db.query(
      `SELECT u.id, u.name FROM course_facilitators cf INNER JOIN users u ON cf.supervisor_id = u.id WHERE cf.course_id = ?`,
      [req.params.id]
    );

    let myEnrollment = null;
    if (req.user.role === 'Trainee') {
      const [enrollRows] = await db.query(
        'SELECT enrollment_id, status, progress FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1',
        [req.user.id, req.params.id]
      );
      myEnrollment = enrollRows[0] || null;
    }

    res.json({ ...courseRows[0], modules, facilitators, myEnrollment });
  } catch (error) {
    console.error('Course detail error:', error);
    res.status(500).json({ error: 'Could not load training details.' });
  }
});

// ============================================================
// POST /api/courses  (Admin only) - create a training
// ============================================================
router.post('/', verifyToken, requireRole('Admin'), async (req, res) => {
  const { title, description, department_target, duration_hours, status } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Training title is required.' });

  try {
    const [result] = await db.query(
      `INSERT INTO courses (title, description, department_target, duration_hours, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        description || null,
        department_target || 'ALL',
        duration_hours || 0,
        status || 'Draft',
        req.user.id
      ]
    );
    res.status(201).json({ message: 'Training created successfully.', courseId: result.insertId });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Could not create training.' });
  }
});

// ============================================================
// PUT /api/courses/:id  (Admin only)
// ============================================================
router.put('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
  const { title, description, department_target, duration_hours, status } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Training title is required.' });

  try {
    const [result] = await db.query(
      `UPDATE courses SET title = ?, description = ?, department_target = ?, duration_hours = ?, status = ?
       WHERE course_id = ?`,
      [title.trim(), description || null, department_target || 'ALL', duration_hours || 0, status || 'Draft', req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Training not found.' });
    res.json({ message: 'Training updated successfully.' });
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Could not update training.' });
  }
});

// ============================================================
// DELETE /api/courses/:id  (Admin only)
// ============================================================
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM courses WHERE course_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Training not found.' });
    res.json({ message: 'Training deleted successfully.' });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Could not delete training.' });
  }
});

// ============================================================
// MODULES (lesson content within a training)
// ============================================================
router.post('/:id/modules', verifyToken, requireRole('Admin'), async (req, res) => {
  const { title, content, sort_order } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Module title is required.' });

  try {
    const [result] = await db.query(
      'INSERT INTO course_modules (course_id, title, content, sort_order) VALUES (?, ?, ?, ?)',
      [req.params.id, title.trim(), content || null, sort_order || 0]
    );
    res.status(201).json({ message: 'Module added.', moduleId: result.insertId });
  } catch (error) {
    console.error('Add module error:', error);
    res.status(500).json({ error: 'Could not add module.' });
  }
});

router.put('/:id/modules/:moduleId', verifyToken, requireRole('Admin'), async (req, res) => {
  const { title, content, sort_order } = req.body;
  try {
    const [result] = await db.query(
      'UPDATE course_modules SET title = ?, content = ?, sort_order = ? WHERE module_id = ? AND course_id = ?',
      [title, content || null, sort_order || 0, req.params.moduleId, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Module not found.' });
    res.json({ message: 'Module updated.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not update module.' });
  }
});

router.delete('/:id/modules/:moduleId', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM course_modules WHERE module_id = ? AND course_id = ?', [
      req.params.moduleId,
      req.params.id
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Module not found.' });
    res.json({ message: 'Module removed.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not remove module.' });
  }
});

// ============================================================
// FACILITATORS (which supervisors can conduct this training)
// ============================================================
router.post('/:id/facilitators', verifyToken, requireRole('Admin'), async (req, res) => {
  const { supervisor_id } = req.body;
  if (!supervisor_id) return res.status(400).json({ error: 'supervisor_id is required.' });

  try {
    await db.query(
      'INSERT IGNORE INTO course_facilitators (course_id, supervisor_id) VALUES (?, ?)',
      [req.params.id, supervisor_id]
    );
    res.status(201).json({ message: 'Supervisor assigned to conduct this training.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not assign supervisor.' });
  }
});

router.delete('/:id/facilitators/:supervisorId', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM course_facilitators WHERE course_id = ? AND supervisor_id = ?', [
      req.params.id,
      req.params.supervisorId
    ]);
    res.json({ message: 'Supervisor removed from this training.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not remove supervisor.' });
  }
});

// ============================================================
// ENROLLMENT
// ============================================================

// List who is enrolled in a training (Admin, or the Supervisor facilitating it)
router.get('/:id/enrollments', verifyToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.enrollment_id, e.status, e.progress, e.enrolled_at, e.completed_at,
              u.id AS user_id, u.name, u.department
       FROM enrollments e
       INNER JOIN users u ON e.user_id = u.id
       WHERE e.course_id = ?
       ORDER BY u.name ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Could not load enrollments.' });
  }
});

// Enroll / assign a trainee into a training (Admin or Supervisor)
router.post('/:id/enroll', verifyToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

  try {
    await db.query(
      `INSERT INTO enrollments (user_id, course_id, status, progress, assigned_by)
       VALUES (?, ?, 'Enrolled', 0, ?)
       ON DUPLICATE KEY UPDATE status = 'Enrolled'`,
      [user_id, req.params.id, req.user.id]
    );
    res.status(201).json({ message: 'Trainee enrolled successfully.' });
  } catch (error) {
    console.error('Enroll error:', error);
    res.status(500).json({ error: 'Could not enroll trainee.' });
  }
});

// A trainee requests to enroll themselves (goes in as "Pending Request")
router.post('/:id/request-enroll', verifyToken, requireRole('Trainee'), async (req, res) => {
  try {
    await db.query(
      `INSERT INTO enrollments (user_id, course_id, status, progress)
       VALUES (?, ?, 'Pending Request', 0)
       ON DUPLICATE KEY UPDATE status = status`,
      [req.user.id, req.params.id]
    );
    res.status(201).json({ message: 'Enrollment request submitted.' });
  } catch (error) {
    console.error('Request enroll error:', error);
    res.status(500).json({ error: 'Could not submit enrollment request.' });
  }
});

// Update progress / status on an enrollment.
// Trainees may only update their own; Admin/Supervisor may update anyone's.
router.put('/:id/enroll/:userId', verifyToken, async (req, res) => {
  const { progress, status } = req.body;
  const isSelf = req.user.role === 'Trainee' && String(req.user.id) === String(req.params.userId);
  const isStaff = req.user.role === 'Admin' || req.user.role === 'Supervisor';

  if (!isSelf && !isStaff) {
    return res.status(403).json({ error: 'You do not have permission to update this enrollment.' });
  }

  try {
    const clampedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
    let resolvedStatus = status;
    let completedAtClause = '';
    const params = [clampedProgress];

    if (!resolvedStatus) {
      resolvedStatus = clampedProgress >= 100 ? 'Completed' : clampedProgress > 0 ? 'In Progress' : 'Enrolled';
    }
    params.push(resolvedStatus);

    if (resolvedStatus === 'Completed') {
      completedAtClause = ', completed_at = CURRENT_TIMESTAMP';
    }

    params.push(req.params.userId, req.params.id);

    const [result] = await db.query(
      `UPDATE enrollments SET progress = ?, status = ? ${completedAtClause} WHERE user_id = ? AND course_id = ?`,
      params
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Enrollment not found.' });

    // Auto-issue a certificate the first time a course is completed
    if (resolvedStatus === 'Completed') {
      const [enrollRows] = await db.query(
        'SELECT enrollment_id FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1',
        [req.params.userId, req.params.id]
      );
      const enrollmentId = enrollRows[0]?.enrollment_id;
      if (enrollmentId) {
        const [existingCert] = await db.query('SELECT certificate_id FROM certificates WHERE enrollment_id = ?', [
          enrollmentId
        ]);
        if (existingCert.length === 0) {
          const code = `CERT-${enrollmentId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          await db.query('INSERT INTO certificates (enrollment_id, certificate_code) VALUES (?, ?)', [
            enrollmentId,
            code
          ]);
        }
      }
    }

    res.json({ message: 'Progress updated.' });
  } catch (error) {
    console.error('Update enrollment error:', error);
    res.status(500).json({ error: 'Could not update progress.' });
  }
});

// Remove an enrollment (Admin/Supervisor)
router.delete('/:id/enroll/:userId', verifyToken, requireRole('Admin', 'Supervisor'), async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?', [
      req.params.userId,
      req.params.id
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Enrollment not found.' });
    res.json({ message: 'Enrollment removed.' });
  } catch (error) {
    res.status(500).json({ error: 'Could not remove enrollment.' });
  }
});

module.exports = router;
