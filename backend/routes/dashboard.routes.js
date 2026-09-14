const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/dashboard/admin
// ============================================================
router.get('/admin', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [[accountStats]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_accounts,
        (SELECT COUNT(*) FROM users u INNER JOIN roles r ON u.role_id = r.role_id WHERE r.role_name = 'Trainee') AS total_trainees,
        (SELECT COUNT(*) FROM users u INNER JOIN roles r ON u.role_id = r.role_id WHERE r.role_name = 'Supervisor') AS total_supervisors,
        (SELECT COUNT(*) FROM courses) AS total_trainings,
        (SELECT COUNT(*) FROM courses WHERE status = 'Published') AS published_trainings,
        (SELECT COUNT(*) FROM enrollments) AS total_enrollments,
        (SELECT COUNT(*) FROM enrollments WHERE status = 'Completed') AS completed_enrollments
    `);

    const completionRate =
      accountStats.total_enrollments > 0
        ? Math.round((accountStats.completed_enrollments / accountStats.total_enrollments) * 1000) / 10
        : 0;

    const [statusBreakdown] = await db.query(
      `SELECT status, COUNT(*) AS count FROM enrollments GROUP BY status`
    );

    const [recentEnrollments] = await db.query(`
      SELECT e.enrolled_at, u.name AS trainee_name, c.title AS course_title, e.status
      FROM enrollments e
      INNER JOIN users u ON e.user_id = u.id
      INNER JOIN courses c ON e.course_id = c.course_id
      ORDER BY e.enrolled_at DESC
      LIMIT 8
    `);

    res.json({
      ...accountStats,
      completion_rate: completionRate,
      status_breakdown: statusBreakdown,
      recent_enrollments: recentEnrollments
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

// ============================================================
// GET /api/dashboard/supervisor
// ============================================================
router.get('/supervisor', verifyToken, requireRole('Supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const [[metrics]] = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE supervisor_id = ?) AS active_trainees,
        (SELECT COUNT(*) FROM enrollments e INNER JOIN users u ON e.user_id = u.id
           WHERE u.supervisor_id = ? AND e.status IN ('Enrolled','In Progress')) AS ongoing_trainings,
        (SELECT COUNT(*) FROM enrollments e INNER JOIN users u ON e.user_id = u.id
           WHERE u.supervisor_id = ? AND e.status = 'Completed') AS completed_trainings,
        (SELECT COUNT(*) FROM course_facilitators WHERE supervisor_id = ?) AS trainings_conducted
      `,
      [supervisorId, supervisorId, supervisorId, supervisorId]
    );

    const [teamList] = await db.query(
      `SELECT u.id, u.name, u.department, u.learning_style,
              COUNT(e.enrollment_id) AS enrolled_count,
              SUM(CASE WHEN e.status = 'Completed' THEN 1 ELSE 0 END) AS completed_count
       FROM users u
       LEFT JOIN enrollments e ON e.user_id = u.id
       WHERE u.supervisor_id = ?
       GROUP BY u.id, u.name, u.department, u.learning_style
       ORDER BY u.name ASC`,
      [supervisorId]
    );

    res.json({ ...metrics, team: teamList });
  } catch (error) {
    console.error('Supervisor dashboard error:', error);
    res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

// ============================================================
// GET /api/dashboard/trainee
// ============================================================
router.get('/trainee', verifyToken, requireRole('Trainee'), async (req, res) => {
  try {
    const traineeId = req.user.id;

    const [[stats]] = await db.query(
      `SELECT
        COUNT(*) AS enrolled,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('Enrolled','In Progress') THEN 1 ELSE 0 END) AS pending
       FROM enrollments WHERE user_id = ?`,
      [traineeId]
    );

    const [courses] = await db.query(
      `SELECT c.course_id, c.title, e.status, e.progress
       FROM enrollments e INNER JOIN courses c ON e.course_id = c.course_id
       WHERE e.user_id = ? ORDER BY e.enrolled_at DESC LIMIT 6`,
      [traineeId]
    );

    res.json({
      enrolled: stats.enrolled || 0,
      completed: stats.completed || 0,
      pending: stats.pending || 0,
      recent_courses: courses
    });
  } catch (error) {
    console.error('Trainee dashboard error:', error);
    res.status(500).json({ error: 'Could not load dashboard.' });
  }
});

module.exports = router;
