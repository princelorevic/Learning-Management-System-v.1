const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const SAFE_USER_FIELDS = `
  u.id, u.name, u.username, r.role_name AS role, u.department, u.learning_style,
  u.supervisor_id, u.gem_link, u.status, u.created_at,
  s.name AS supervisor_name
`;

// ============================================================
// GET /api/users  (Admin only) - list all accounts
// Optional query params: ?role=Trainee&search=juan
// ============================================================
router.get('/', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const { role, search } = req.query;
    const conditions = [];
    const params = [];

    if (role) {
      conditions.push('r.role_name = ?');
      params.push(role);
    }
    if (search) {
      conditions.push('(u.name LIKE ? OR u.username LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT ${SAFE_USER_FIELDS}
       FROM users u
       INNER JOIN roles r ON u.role_id = r.role_id
       LEFT JOIN users s ON u.supervisor_id = s.id
       ${whereClause}
       ORDER BY u.id DESC`,
      params
    );

    res.json(rows);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Could not load accounts.' });
  }
});

// ============================================================
// GET /api/users/supervisors  - lightweight list for dropdowns
// (Admin only; Supervisor role picking happens on the create/edit form)
// ============================================================
router.get('/supervisors', verifyToken, requireRole('Admin'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name FROM users u
       INNER JOIN roles r ON u.role_id = r.role_id
       WHERE r.role_name = 'Supervisor' AND u.status = 'active'
       ORDER BY u.name ASC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Could not load supervisors.' });
  }
});

// ============================================================
// POST /api/users  (Admin only) - create an account
// ============================================================
router.post('/', verifyToken, requireRole('Admin'), async (req, res) => {
  const { name, username, password, role, supervisor_id, department, learning_style, gem_link } = req.body;

  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'Name, username, password and role are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const [roleRows] = await db.query('SELECT role_id FROM roles WHERE role_name = ? LIMIT 1', [role]);
    if (roleRows.length === 0) {
      return res.status(400).json({ error: `Role '${role}' does not exist.` });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (name, username, password, role_id, supervisor_id, department, learning_style, gem_link)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        username,
        hashedPassword,
        roleRows[0].role_id,
        supervisor_id || null,
        department || null,
        learning_style || 'Not Assessed',
        gem_link || null
      ]
    );

    res.status(201).json({ message: 'Account created successfully.', userId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'That username is already taken.' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// ============================================================
// PUT /api/users/:id  (Admin only) - update an account
// ============================================================
router.put('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
  const userId = req.params.id;
  const { name, username, password, role, supervisor_id, department, learning_style, gem_link, status } = req.body;

  if (!name || !username || !role) {
    return res.status(400).json({ error: 'Name, username and role are required.' });
  }

  try {
    const [roleRows] = await db.query('SELECT role_id FROM roles WHERE role_name = ? LIMIT 1', [role]);
    if (roleRows.length === 0) {
      return res.status(400).json({ error: `Role '${role}' does not exist.` });
    }

    const fields = [
      'name = ?', 'username = ?', 'role_id = ?', 'supervisor_id = ?',
      'department = ?', 'learning_style = ?', 'gem_link = ?', 'status = ?'
    ];
    const params = [
      name, username, roleRows[0].role_id, supervisor_id || null,
      department || null, learning_style || 'Not Assessed', gem_link || null, status || 'active'
    ];

    if (password && password.trim() !== '') {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      fields.push('password = ?');
      params.push(await bcrypt.hash(password, 10));
    }

    params.push(userId);

    const [result] = await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    res.json({ message: 'Account updated successfully.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'That username is already taken.' });
    }
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Could not update account.' });
  }
});

// ============================================================
// DELETE /api/users/:id  (Admin only)
// ============================================================
router.delete('/:id', verifyToken, requireRole('Admin'), async (req, res) => {
  const userId = req.params.id;

  if (String(req.user.id) === String(userId)) {
    return res.status(400).json({ error: 'You cannot delete your own account while logged in as it.' });
  }

  try {
    const [result] = await db.query('DELETE FROM users WHERE id = ?', [userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    res.json({ message: 'Account deleted successfully.' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Could not delete account.' });
  }
});

module.exports = router;
