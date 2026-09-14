const express = require('express');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendExcelReport } = require('../utils/excel');

const router = express.Router();

// ============================================================
// GET /api/reports/admin/trainees  (Admin) - Excel
// ============================================================
router.get('/admin/trainees', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.name, u.username, u.department, u.learning_style,
             s.name AS supervisor, COUNT(e.enrollment_id) AS trainings_enrolled,
             SUM(CASE WHEN e.status = 'Completed' THEN 1 ELSE 0 END) AS trainings_completed
      FROM users u
      INNER JOIN roles r ON u.role_id = r.role_id
      LEFT JOIN users s ON u.supervisor_id = s.id
      LEFT JOIN enrollments e ON e.user_id = u.id
      WHERE r.role_name = 'Trainee'
      GROUP BY u.id, u.name, u.username, u.department, u.learning_style, s.name
      ORDER BY u.name ASC
    `);

    await sendExcelReport(
      res,
      'trainee-report',
      'Trainees',
      [
        { header: 'Name', key: 'name' },
        { header: 'Username', key: 'username' },
        { header: 'Department', key: 'department' },
        { header: 'Learning Style', key: 'learning_style' },
        { header: 'Supervisor', key: 'supervisor' },
        { header: 'Trainings Enrolled', key: 'trainings_enrolled' },
        { header: 'Trainings Completed', key: 'trainings_completed' }
      ],
      rows
    );
  } catch (error) {
    console.error('Trainee report error:', error);
    res.status(500).json({ error: 'Could not generate report.' });
  }
});

// ============================================================
// GET /api/reports/admin/supervisors  (Admin) - Excel
// ============================================================
router.get('/admin/supervisors', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT sup.name, sup.username, sup.department,
             COUNT(DISTINCT t.id) AS team_size,
             COUNT(DISTINCT cf.course_id) AS trainings_conducted,
             SUM(CASE WHEN e.status = 'Completed' THEN 1 ELSE 0 END) AS team_completions
      FROM users sup
      INNER JOIN roles r ON sup.role_id = r.role_id
      LEFT JOIN users t ON t.supervisor_id = sup.id
      LEFT JOIN enrollments e ON e.user_id = t.id
      LEFT JOIN course_facilitators cf ON cf.supervisor_id = sup.id
      WHERE r.role_name = 'Supervisor'
      GROUP BY sup.id, sup.name, sup.username, sup.department
      ORDER BY sup.name ASC
    `);

    await sendExcelReport(
      res,
      'supervisor-report',
      'Supervisors',
      [
        { header: 'Name', key: 'name' },
        { header: 'Username', key: 'username' },
        { header: 'Department', key: 'department' },
        { header: 'Team Size', key: 'team_size' },
        { header: 'Trainings Conducted', key: 'trainings_conducted' },
        { header: 'Team Completions', key: 'team_completions' }
      ],
      rows
    );
  } catch (error) {
    console.error('Supervisor report error:', error);
    res.status(500).json({ error: 'Could not generate report.' });
  }
});

// ============================================================
// GET /api/reports/admin/trainings  (Admin) - Excel
// ============================================================
router.get('/admin/trainings', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT c.title, c.department_target, c.status, c.duration_hours,
             COUNT(e.enrollment_id) AS enrolled_count,
             SUM(CASE WHEN e.status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
             ROUND(AVG(e.progress), 1) AS avg_progress
      FROM courses c
      LEFT JOIN enrollments e ON e.course_id = c.course_id
      GROUP BY c.course_id, c.title, c.department_target, c.status, c.duration_hours
      ORDER BY c.created_at DESC
    `);

    await sendExcelReport(
      res,
      'training-report',
      'Trainings',
      [
        { header: 'Title', key: 'title', width: 32 },
        { header: 'Department', key: 'department_target' },
        { header: 'Status', key: 'status' },
        { header: 'Duration (hrs)', key: 'duration_hours' },
        { header: 'Enrolled', key: 'enrolled_count' },
        { header: 'Completed', key: 'completed_count' },
        { header: 'Avg. Progress %', key: 'avg_progress' }
      ],
      rows
    );
  } catch (error) {
    console.error('Training report error:', error);
    res.status(500).json({ error: 'Could not generate report.' });
  }
});

// ============================================================
// GET /api/reports/supervisor/team  (Supervisor) - Excel
// ============================================================
router.get('/supervisor/team', verifyToken, requireRole('Supervisor'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.name, u.username, u.department, u.learning_style,
              COUNT(e.enrollment_id) AS trainings_enrolled,
              SUM(CASE WHEN e.status = 'Completed' THEN 1 ELSE 0 END) AS trainings_completed,
              ROUND(AVG(e.progress), 1) AS avg_progress
       FROM users u
       LEFT JOIN enrollments e ON e.user_id = u.id
       WHERE u.supervisor_id = ?
       GROUP BY u.id, u.name, u.username, u.department, u.learning_style
       ORDER BY u.name ASC`,
      [req.user.id]
    );

    await sendExcelReport(
      res,
      'my-team-report',
      'My Team',
      [
        { header: 'Name', key: 'name' },
        { header: 'Username', key: 'username' },
        { header: 'Department', key: 'department' },
        { header: 'Learning Style', key: 'learning_style' },
        { header: 'Trainings Enrolled', key: 'trainings_enrolled' },
        { header: 'Trainings Completed', key: 'trainings_completed' },
        { header: 'Avg. Progress %', key: 'avg_progress' }
      ],
      rows
    );
  } catch (error) {
    console.error('Team report error:', error);
    res.status(500).json({ error: 'Could not generate report.' });
  }
});

module.exports = router;
