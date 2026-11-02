// ============================================================
// COURSE BUILDER API  (mounted at /api/builder)
//
// A training is an ordered list of "units". A unit can be:
//   lesson (text) | web | video | audio | presentation | document |
//   iframe | quiz (test) | survey | assignment | ilt | section
// A section is just a heading row; the units under it belong to it.
// A unit can also be LINKED from another training (a live reference
// to the original, via linked_module_id) or CLONED (a real copy).
// ============================================================
const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

const UNIT_TYPES = [
  'lesson', 'web', 'video', 'audio', 'presentation', 'document', 'iframe',
  'quiz', 'survey', 'assignment', 'ilt', 'section'
];
const URL_TYPES = ['web', 'audio', 'presentation', 'document', 'iframe'];
const DEFAULT_TITLE = {
  lesson: 'New text unit', web: 'New web content', video: 'New video', audio: 'New audio',
  presentation: 'New presentation', document: 'New document', iframe: 'New frame',
  quiz: 'New test', survey: 'New survey', assignment: 'New assignment',
  ilt: 'New instructor-led session', section: 'New section'
};

// ---------------- small helpers ----------------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      console.error('Builder error:', err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function cleanUrl(value, label = 'Link') {
  let v = String(value || '').trim();
  if (!v) return null;
  if (v.startsWith('//')) v = `https:${v}`;
  if (v.length > 1000) fail(400, `${label} is too long.`);
  if (!/^https?:\/\/[^\s<>"']+$/i.test(v)) fail(400, `${label} must start with http:// or https://`);
  return v;
}

// People often paste the whole <iframe ...> embed code: pull the address out of it.
function extractIframeSrc(value) {
  const v = String(value || '').trim();
  const m = v.match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : v;
}

function cleanText(value, max, label) {
  const v = String(value ?? '').trim();
  if (v.length > max) fail(400, `${label} is too long (max ${max} characters).`);
  return v;
}

function shortId() { return crypto.randomBytes(4).toString('hex'); }

// Per-type settings are stored as JSON text. Only known keys are kept.
function sanitizeSettings(type, input) {
  if (input === null || input === undefined) return null;
  const s = typeof input === 'string' ? parseJson(input) : input;
  if (!s || typeof s !== 'object') return null;

  if (type === 'survey') {
    const questions = Array.isArray(s.questions) ? s.questions.slice(0, 50) : [];
    const clean = questions
      .map((q) => {
        const qType = ['choice', 'text', 'rating'].includes(q.type) ? q.type : 'choice';
        const options = qType === 'choice'
          ? (Array.isArray(q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 200)).filter(Boolean).slice(0, 10)
          : [];
        return {
          id: /^[a-z0-9]{4,16}$/i.test(String(q.id || '')) ? String(q.id) : shortId(),
          text: String(q.text || '').trim().slice(0, 500),
          type: qType,
          options,
          required: !!q.required
        };
      })
      .filter((q) => q.text && (q.type !== 'choice' || q.options.length >= 2));
    return JSON.stringify({ questions: clean });
  }
  if (type === 'ilt') {
    return JSON.stringify({
      date: String(s.date || '').slice(0, 20),
      start_time: String(s.start_time || '').slice(0, 10),
      end_time: String(s.end_time || '').slice(0, 10),
      location: String(s.location || '').trim().slice(0, 200),
      meeting_link: cleanUrl(s.meeting_link, 'Meeting link') || '',
      instructor: String(s.instructor || '').trim().slice(0, 150)
    });
  }
  if (type === 'assignment') {
    return JSON.stringify({ due_date: String(s.due_date || '').slice(0, 20) });
  }
  return null;
}

// ---------------- reading units (resolving links) ----------------
const pick = (col) => `CASE WHEN m.linked_module_id IS NULL THEN m.${col} ELSE s.${col} END AS ${col}`;
const CONTENT_ID = 'CASE WHEN m.linked_module_id IS NULL THEN m.module_id ELSE s.module_id END';
const RESOLVED_COLUMNS = `
  m.module_id, m.course_id, m.sort_order, m.linked_module_id,
  ${CONTENT_ID} AS content_id,
  ${pick('module_type')}, ${pick('title')}, ${pick('content')}, ${pick('video_url')},
  ${pick('resource_url')}, ${pick('settings')}, ${pick('pass_percent')},
  s.course_id AS source_course_id, sc.title AS source_course_title,
  (SELECT COUNT(*) FROM quiz_questions q WHERE q.module_id = ${CONTENT_ID}) AS question_count
`;
const RESOLVED_FROM = `
  FROM course_modules m
  LEFT JOIN course_modules s ON m.linked_module_id = s.module_id
  LEFT JOIN courses sc ON s.course_id = sc.course_id
`;

function shapeUnit(row) {
  return {
    module_id: row.module_id,
    content_id: row.content_id,
    course_id: row.course_id,
    sort_order: row.sort_order,
    module_type: row.module_type,
    title: row.title,
    content: row.content,
    video_url: row.video_url,
    resource_url: row.resource_url,
    pass_percent: row.pass_percent || 70,
    settings: parseJson(row.settings) || {},
    question_count: Number(row.question_count) || 0,
    is_linked: !!row.linked_module_id,
    source_course_id: row.source_course_id || null,
    source_course_title: row.source_course_title || null
  };
}

async function getUnit(id) {
  const [rows] = await db.query(`SELECT ${RESOLVED_COLUMNS} ${RESOLVED_FROM} WHERE m.module_id = ? LIMIT 1`, [id]);
  if (rows.length === 0) fail(404, 'Unit not found.');
  return rows[0];
}

async function getCourse(id) {
  const [rows] = await db.query('SELECT * FROM courses WHERE course_id = ? LIMIT 1', [id]);
  if (rows.length === 0) fail(404, 'Training not found.');
  return rows[0];
}

async function getEnrollment(userId, courseId) {
  const [rows] = await db.query(
    'SELECT enrollment_id, status, progress FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1',
    [userId, courseId]
  );
  return rows[0] || null;
}

// ---------------- ordering ----------------
async function normalizeOrder(courseId) {
  const [rows] = await db.query(
    'SELECT module_id FROM course_modules WHERE course_id = ? ORDER BY sort_order ASC, module_id ASC',
    [courseId]
  );
  for (let i = 0; i < rows.length; i++) {
    await db.query('UPDATE course_modules SET sort_order = ? WHERE module_id = ?', [i + 1, rows[i].module_id]);
  }
  return rows.map((r) => Number(r.module_id));
}

// Returns the sort_order a new unit should get (end of list, or right after `afterId`).
async function nextPosition(courseId, afterId) {
  if (afterId) {
    const ids = await normalizeOrder(courseId);
    const idx = ids.indexOf(Number(afterId));
    if (idx !== -1) {
      await db.query('UPDATE course_modules SET sort_order = sort_order + 1 WHERE course_id = ? AND sort_order > ?', [courseId, idx + 1]);
      return idx + 2;
    }
  }
  const [[row]] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM course_modules WHERE course_id = ?', [courseId]);
  return Number(row.max_order) + 1;
}

async function insertUnit(courseId, f, sortOrder) {
  const [result] = await db.query(
    `INSERT INTO course_modules
       (course_id, title, module_type, content, video_url, resource_url, settings, pass_percent, linked_module_id, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      courseId, f.title, f.module_type, f.content || null, f.video_url || null, f.resource_url || null,
      f.settings || null, f.pass_percent || 70, f.linked_module_id || null, sortOrder
    ]
  );
  return result.insertId;
}

async function cloneQuizQuestions(fromModuleId, toModuleId) {
  const [questions] = await db.query(
    'SELECT question_id, question_text, sort_order FROM quiz_questions WHERE module_id = ? ORDER BY sort_order ASC, question_id ASC',
    [fromModuleId]
  );
  for (const q of questions) {
    const [qr] = await db.query(
      'INSERT INTO quiz_questions (module_id, question_text, sort_order) VALUES (?, ?, ?)',
      [toModuleId, q.question_text, q.sort_order]
    );
    const [choices] = await db.query(
      'SELECT choice_text, is_correct, sort_order FROM quiz_choices WHERE question_id = ? ORDER BY sort_order ASC, choice_id ASC',
      [q.question_id]
    );
    for (const c of choices) {
      await db.query(
        'INSERT INTO quiz_choices (question_id, choice_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
        [qr.insertId, c.choice_text, c.is_correct ? 1 : 0, c.sort_order]
      );
    }
  }
}

// Copies a (resolved) unit into a course. Quizzes bring their questions along.
async function cloneUnitInto(courseId, unit, sortOrder, titleSuffix = '') {
  const newId = await insertUnit(courseId, {
    title: `${unit.title}${titleSuffix}`.slice(0, 200),
    module_type: unit.module_type,
    content: unit.content,
    video_url: unit.video_url,
    resource_url: unit.resource_url,
    settings: unit.settings,
    pass_percent: unit.pass_percent
  }, sortOrder);
  if (unit.module_type === 'quiz') await cloneQuizQuestions(unit.content_id, newId);
  return newId;
}

// ---------------- who may see a course ----------------
async function assertCanViewCourse(req, course) {
  const role = req.user.role;
  if (role === 'Admin') return null;

  if (role === 'Supervisor') {
    if (course.status === 'Published' || String(course.created_by) === String(req.user.id)) return null;
    const [f] = await db.query('SELECT 1 AS ok FROM course_facilitators WHERE course_id = ? AND supervisor_id = ? LIMIT 1', [course.course_id, req.user.id]);
    if (f.length === 0) fail(403, 'You do not have access to this training.');
    return null;
  }

  // Trainee: must be enrolled (an unapproved request does not count) in a published training
  const enrollment = await getEnrollment(req.user.id, course.course_id);
  if (!enrollment || enrollment.status === 'Pending Request') {
    fail(403, 'You are not enrolled in this training yet.');
  }
  if (course.status !== 'Published') fail(403, 'This training is not available right now.');
  return enrollment;
}

// ============================================================
// GET /api/builder/courses/:id/outline
// The whole training: details + ordered units (+ my progress for trainees)
// ============================================================
router.get('/courses/:id/outline', verifyToken, wrap(async (req, res) => {
  const course = await getCourse(req.params.id);
  const enrollment = await assertCanViewCourse(req, course);

  const [rows] = await db.query(
    `SELECT ${RESOLVED_COLUMNS} ${RESOLVED_FROM}
     WHERE m.course_id = ? ORDER BY m.sort_order ASC, m.module_id ASC`,
    [course.course_id]
  );
  const units = rows.map(shapeUnit);

  if (req.user.role === 'Trainee') {
    const [done] = await db.query(
      `SELECT mp.module_id FROM module_progress mp
       INNER JOIN course_modules m ON mp.module_id = m.module_id
       WHERE mp.user_id = ? AND m.course_id = ?`,
      [req.user.id, course.course_id]
    );
    const doneIds = new Set(done.map((d) => Number(d.module_id)));
    units.forEach((u) => { u.completed = doneIds.has(Number(u.module_id)); });
  }

  res.json({
    course: {
      course_id: course.course_id,
      title: course.title,
      description: course.description,
      image_url: course.image_url || null,
      status: course.status,
      department_target: course.department_target,
      duration_hours: course.duration_hours
    },
    units,
    enrollment: enrollment ? { status: enrollment.status, progress: enrollment.progress } : null,
    can_edit: req.user.role === 'Admin'
  });
}));

// ============================================================
// PUT /api/builder/courses/:id/meta   (Admin)
// Title, description, cover image, status... send only what changed.
// ============================================================
router.put('/courses/:id/meta', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  await getCourse(req.params.id);
  const b = req.body || {};
  const sets = [];
  const params = [];

  if (b.title !== undefined) {
    const t = cleanText(b.title, 200, 'Title');
    if (!t) fail(400, 'Title is required.');
    sets.push('title = ?'); params.push(t);
  }
  if (b.description !== undefined) {
    sets.push('description = ?'); params.push(cleanText(b.description, 5000, 'Description') || null);
  }
  if (b.image_url !== undefined) {
    const v = String(b.image_url || '').trim();
    if (v === '') {
      sets.push('image_url = ?'); params.push(null);
    } else if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)) {
      if (v.length > 1500000) fail(400, 'That image is too large. Please use a smaller one.');
      sets.push('image_url = ?'); params.push(v);
    } else {
      sets.push('image_url = ?'); params.push(cleanUrl(v, 'Image link'));
    }
  }
  if (b.department_target !== undefined) {
    sets.push('department_target = ?'); params.push(cleanText(b.department_target, 100, 'Department') || 'ALL');
  }
  if (b.duration_hours !== undefined) {
    const h = Number(b.duration_hours);
    if (!Number.isFinite(h) || h < 0 || h > 9999) fail(400, 'Duration must be a number of hours.');
    sets.push('duration_hours = ?'); params.push(h);
  }
  if (b.status !== undefined) {
    if (!['Draft', 'Published', 'Archived'].includes(b.status)) fail(400, 'Invalid status.');
    sets.push('status = ?'); params.push(b.status);
  }
  if (sets.length === 0) fail(400, 'Nothing to update.');

  params.push(req.params.id);
  await db.query(`UPDATE courses SET ${sets.join(', ')} WHERE course_id = ?`, params);
  res.json({ message: 'Saved.' });
}));

// ============================================================
// Units: create / update / delete / reorder / duplicate
// ============================================================
function buildUnitFields(type, body) {
  const f = {};
  if (body.title !== undefined) {
    const t = cleanText(body.title, 200, 'Title');
    if (!t) fail(400, 'Title is required.');
    f.title = t;
  }
  if (body.content !== undefined) {
    const c = String(body.content ?? '');
    if (c.length > 50000) fail(400, 'Content is too long.');
    f.content = c.trim() ? c : null;
  }
  if (type === 'video' && body.video_url !== undefined) {
    f.video_url = cleanUrl(body.video_url, 'Video link');
  }
  if (URL_TYPES.includes(type) && body.resource_url !== undefined) {
    f.resource_url = cleanUrl(type === 'iframe' ? extractIframeSrc(body.resource_url) : body.resource_url, 'Link');
  }
  if (type === 'quiz' && body.pass_percent !== undefined) {
    const p = parseInt(body.pass_percent, 10);
    if (!Number.isFinite(p) || p < 0 || p > 100) fail(400, 'Passing score must be between 0 and 100.');
    f.pass_percent = p;
  }
  if (body.settings !== undefined) f.settings = sanitizeSettings(type, body.settings);
  return f;
}

router.post('/courses/:id/units', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  const courseId = Number(req.params.id);
  await getCourse(courseId);
  const type = req.body.module_type;
  if (!UNIT_TYPES.includes(type)) fail(400, 'Unknown unit type.');

  const f = buildUnitFields(type, req.body);
  f.title = f.title || DEFAULT_TITLE[type];
  f.module_type = type;

  const position = await nextPosition(courseId, req.body.after_module_id);
  const id = await insertUnit(courseId, f, position);
  res.status(201).json({ message: 'Unit added.', moduleId: id });
}));

router.put('/units/:id', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  const [rows] = await db.query('SELECT * FROM course_modules WHERE module_id = ? LIMIT 1', [req.params.id]);
  if (rows.length === 0) fail(404, 'Unit not found.');
  const unit = rows[0];
  if (unit.linked_module_id) {
    fail(400, 'This unit is linked from another training. Edit it in the original training, or clone it to get your own copy.');
  }

  const f = buildUnitFields(unit.module_type, req.body);
  const keys = Object.keys(f);
  if (keys.length === 0) fail(400, 'Nothing to update.');

  const sets = keys.map((k) => `${k} = ?`).join(', ');
  await db.query(`UPDATE course_modules SET ${sets} WHERE module_id = ?`, [...keys.map((k) => f[k]), unit.module_id]);
  res.json({ message: 'Saved.' });
}));

router.delete('/units/:id', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  const [result] = await db.query('DELETE FROM course_modules WHERE module_id = ?', [req.params.id]);
  if (result.affectedRows === 0) fail(404, 'Unit not found.');
  res.json({ message: 'Unit removed.' });
}));

router.put('/courses/:id/order', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  const courseId = Number(req.params.id);
  const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
  const [rows] = await db.query('SELECT module_id FROM course_modules WHERE course_id = ?', [courseId]);
  const existing = new Set(rows.map((r) => Number(r.module_id)));
  if (order.length !== existing.size || !order.every((id) => existing.has(id)) || new Set(order).size !== order.length) {
    fail(400, 'The new order does not match the units in this training. Please refresh the page.');
  }
  for (let i = 0; i < order.length; i++) {
    await db.query('UPDATE course_modules SET sort_order = ? WHERE module_id = ? AND course_id = ?', [i + 1, order[i], courseId]);
  }
  res.json({ message: 'Order saved.' });
}));

router.post('/units/:id/duplicate', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  const unit = await getUnit(req.params.id);
  const position = await nextPosition(unit.course_id, unit.module_id);
  let id;
  if (unit.linked_module_id) {
    // duplicating a linked unit gives another link to the same original
    id = await insertUnit(unit.course_id, {
      title: unit.title, module_type: unit.module_type, linked_module_id: unit.content_id
    }, position);
  } else {
    id = await cloneUnitInto(unit.course_id, unit, position, ' (copy)');
  }
  res.status(201).json({ message: 'Unit duplicated.', moduleId: id });
}));

// ============================================================
// POST /api/builder/courses/:id/import   (Admin)
// Clone (real copy) or Link (live reference) units from another training.
// ============================================================
router.post('/courses/:id/import', verifyToken, requireRole('Admin'), wrap(async (req, res) => {
  const courseId = Number(req.params.id);
  await getCourse(courseId);
  const { source_course_id, module_ids, mode } = req.body;

  if (!['clone', 'link'].includes(mode)) fail(400, 'Choose clone or link.');
  if (!Array.isArray(module_ids) || module_ids.length === 0) fail(400, 'Pick at least one unit.');
  await getCourse(source_course_id);
  if (mode === 'link' && Number(source_course_id) === courseId) fail(400, 'Link units from a different training.');

  const wanted = new Set(module_ids.map(Number));
  const [units] = await db.query(
    `SELECT ${RESOLVED_COLUMNS} ${RESOLVED_FROM}
     WHERE m.course_id = ? ORDER BY m.sort_order ASC, m.module_id ASC`,
    [source_course_id]
  );
  const chosen = units.filter((u) => wanted.has(Number(u.module_id)));
  if (chosen.length === 0) fail(400, 'None of the selected units were found in that training.');

  let position = await nextPosition(courseId, null);
  let added = 0;
  for (const u of chosen) {
    if (mode === 'link') {
      if (u.module_type === 'section') continue; // sections are only cloned, never linked
      await insertUnit(courseId, {
        title: u.title, module_type: u.module_type, linked_module_id: u.content_id
      }, position++);
    } else {
      await cloneUnitInto(courseId, u, position++);
    }
    added++;
  }
  if (added === 0) fail(400, 'Sections cannot be linked. Use Clone for sections.');
  res.json({ message: mode === 'link' ? `${added} unit(s) linked.` : `${added} unit(s) cloned.`, added });
}));

// ============================================================
// Completion + progress
// ============================================================
async function recomputeProgress(userId, courseId, enrollmentId) {
  const [[tot]] = await db.query(
    "SELECT COUNT(*) AS total FROM course_modules WHERE course_id = ? AND module_type <> 'section'",
    [courseId]
  );
  const [[done]] = await db.query(
    `SELECT COUNT(*) AS done FROM module_progress mp
     INNER JOIN course_modules m ON mp.module_id = m.module_id
     WHERE mp.user_id = ? AND m.course_id = ? AND m.module_type <> 'section'`,
    [userId, courseId]
  );
  const total = Number(tot.total);
  const d = Number(done.done);
  const progress = total ? Math.min(100, Math.round((d / total) * 10000) / 100) : 0;
  const status = progress >= 100 ? 'Completed' : d > 0 ? 'In Progress' : 'Enrolled';

  if (status === 'Completed') {
    await db.query(
      'UPDATE enrollments SET progress = ?, status = ?, completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE enrollment_id = ?',
      [progress, status, enrollmentId]
    );
    const [existing] = await db.query('SELECT certificate_id FROM certificates WHERE enrollment_id = ?', [enrollmentId]);
    if (existing.length === 0) {
      const code = `CERT-${enrollmentId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      await db.query('INSERT INTO certificates (enrollment_id, certificate_code) VALUES (?, ?)', [enrollmentId, code]);
    }
  } else {
    await db.query('UPDATE enrollments SET progress = ?, status = ? WHERE enrollment_id = ?', [progress, status, enrollmentId]);
  }
  return { progress, status, completed_units: d, total_units: total };
}

async function markComplete(userId, unit) {
  if (unit.module_type === 'section') fail(400, 'Sections do not need to be completed.');

  const enrollment = await getEnrollment(userId, unit.course_id);
  if (!enrollment || enrollment.status === 'Pending Request') fail(403, 'You are not enrolled in this training yet.');
  const course = await getCourse(unit.course_id);
  if (course.status !== 'Published') fail(403, 'This training is not available right now.');

  if (unit.module_type === 'quiz') {
    const [a] = await db.query('SELECT attempt_id FROM quiz_attempts WHERE module_id = ? AND user_id = ? AND passed = 1 LIMIT 1', [unit.content_id, userId]);
    if (a.length === 0) fail(400, 'Pass the test first to complete this unit.');
  }
  if (unit.module_type === 'survey') {
    const [r] = await db.query('SELECT response_id FROM survey_responses WHERE module_id = ? AND user_id = ? LIMIT 1', [unit.content_id, userId]);
    if (r.length === 0) fail(400, 'Submit the survey first.');
  }
  if (unit.module_type === 'assignment') {
    const [r] = await db.query('SELECT submission_id FROM assignment_submissions WHERE module_id = ? AND user_id = ? LIMIT 1', [unit.content_id, userId]);
    if (r.length === 0) fail(400, 'Submit your assignment first.');
  }

  const [existing] = await db.query('SELECT module_id FROM module_progress WHERE user_id = ? AND module_id = ? LIMIT 1', [userId, unit.module_id]);
  if (existing.length === 0) {
    await db.query('INSERT INTO module_progress (user_id, module_id) VALUES (?, ?)', [userId, unit.module_id]);
  }
  return recomputeProgress(userId, unit.course_id, enrollment.enrollment_id);
}

router.post('/units/:id/complete', verifyToken, requireRole('Trainee'), wrap(async (req, res) => {
  const unit = await getUnit(req.params.id);
  const result = await markComplete(req.user.id, unit);
  res.json({ message: 'Unit completed.', ...result });
}));

// ============================================================
// Surveys + assignments
// ============================================================
// GET /api/builder/units/:id/activity
//   Trainee -> their own survey answer / assignment submission
//   Admin / Supervisor -> everyone's (supervisors see their own team only)
router.get('/units/:id/activity', verifyToken, wrap(async (req, res) => {
  const unit = await getUnit(req.params.id);
  if (!['survey', 'assignment'].includes(unit.module_type)) fail(400, 'This unit has no responses.');
  const isTrainee = req.user.role === 'Trainee';

  if (isTrainee) {
    const enrollment = await getEnrollment(req.user.id, unit.course_id);
    if (!enrollment || enrollment.status === 'Pending Request') fail(403, 'You are not enrolled in this training yet.');
  }

  const table = unit.module_type === 'survey' ? 'survey_responses' : 'assignment_submissions';
  const fields = unit.module_type === 'survey'
    ? 'r.response_id AS id, r.answers, r.submitted_at'
    : 'r.submission_id AS id, r.content, r.link, r.status, r.feedback, r.submitted_at, r.reviewed_at';

  if (isTrainee) {
    const [rows] = await db.query(`SELECT ${fields} FROM ${table} r WHERE r.module_id = ? AND r.user_id = ? LIMIT 1`, [unit.content_id, req.user.id]);
    const mine = rows[0] || null;
    if (mine && mine.answers) mine.answers = parseJson(mine.answers) || {};
    return res.json({ type: unit.module_type, mine });
  }

  const params = [unit.content_id];
  let team = '';
  if (req.user.role === 'Supervisor') { team = 'AND u.supervisor_id = ?'; params.push(req.user.id); }
  const [rows] = await db.query(
    `SELECT ${fields}, u.id AS user_id, u.name AS user_name
     FROM ${table} r INNER JOIN users u ON r.user_id = u.id
     WHERE r.module_id = ? ${team} ORDER BY r.submitted_at DESC`,
    params
  );
  rows.forEach((r) => { if (r.answers) r.answers = parseJson(r.answers) || {}; });
  res.json({ type: unit.module_type, responses: rows });
}));

router.post('/units/:id/survey', verifyToken, requireRole('Trainee'), wrap(async (req, res) => {
  const unit = await getUnit(req.params.id);
  if (unit.module_type !== 'survey') fail(400, 'This unit is not a survey.');
  const questions = (parseJson(unit.settings) || {}).questions || [];
  if (questions.length === 0) fail(400, 'This survey has no questions yet.');

  const given = (req.body && req.body.answers) || {};
  const answers = {};
  for (const q of questions) {
    let v = given[q.id];
    if (q.type === 'text') {
      v = String(v ?? '').trim().slice(0, 2000);
    } else if (q.type === 'rating') {
      v = v === '' || v === undefined || v === null ? '' : parseInt(v, 10);
      if (v !== '' && !(v >= 1 && v <= 5)) fail(400, `Pick a rating from 1 to 5 for: ${q.text}`);
    } else {
      v = String(v ?? '');
      if (v !== '' && !q.options.includes(v)) fail(400, `Pick one of the choices for: ${q.text}`);
    }
    if (q.required && (v === '' || v === null)) fail(400, `Please answer: ${q.text}`);
    answers[q.id] = v;
  }

  const enrollment = await getEnrollment(req.user.id, unit.course_id);
  if (!enrollment || enrollment.status === 'Pending Request') fail(403, 'You are not enrolled in this training yet.');

  const [existing] = await db.query('SELECT response_id FROM survey_responses WHERE module_id = ? AND user_id = ? LIMIT 1', [unit.content_id, req.user.id]);
  if (existing.length) {
    await db.query('UPDATE survey_responses SET answers = ?, submitted_at = CURRENT_TIMESTAMP WHERE response_id = ?', [JSON.stringify(answers), existing[0].response_id]);
  } else {
    await db.query('INSERT INTO survey_responses (module_id, user_id, answers) VALUES (?, ?, ?)', [unit.content_id, req.user.id, JSON.stringify(answers)]);
  }
  const progress = await markComplete(req.user.id, unit);
  res.json({ message: 'Thanks! Your answers were saved.', ...progress });
}));

router.post('/units/:id/assignment', verifyToken, requireRole('Trainee'), wrap(async (req, res) => {
  const unit = await getUnit(req.params.id);
  if (unit.module_type !== 'assignment') fail(400, 'This unit is not an assignment.');

  const content = cleanText(req.body.content, 20000, 'Your answer');
  const link = cleanUrl(req.body.link, 'Link');
  if (!content && !link) fail(400, 'Write your answer or paste a link before submitting.');

  const enrollment = await getEnrollment(req.user.id, unit.course_id);
  if (!enrollment || enrollment.status === 'Pending Request') fail(403, 'You are not enrolled in this training yet.');

  const [existing] = await db.query('SELECT submission_id FROM assignment_submissions WHERE module_id = ? AND user_id = ? LIMIT 1', [unit.content_id, req.user.id]);
  if (existing.length) {
    await db.query(
      `UPDATE assignment_submissions
       SET content = ?, link = ?, status = 'Submitted', submitted_at = CURRENT_TIMESTAMP
       WHERE submission_id = ?`,
      [content || null, link, existing[0].submission_id]
    );
  } else {
    await db.query(
      'INSERT INTO assignment_submissions (module_id, user_id, content, link) VALUES (?, ?, ?, ?)',
      [unit.content_id, req.user.id, content || null, link]
    );
  }
  const progress = await markComplete(req.user.id, unit);
  res.json({ message: 'Assignment submitted.', ...progress });
}));

router.put('/submissions/:id/review', verifyToken, requireRole('Admin', 'Supervisor'), wrap(async (req, res) => {
  const status = req.body.status;
  if (!['Approved', 'Needs revision'].includes(status)) fail(400, 'Choose Approved or Needs revision.');
  const feedback = cleanText(req.body.feedback, 3000, 'Feedback');

  const [rows] = await db.query(
    `SELECT s.submission_id, u.supervisor_id FROM assignment_submissions s
     INNER JOIN users u ON s.user_id = u.id WHERE s.submission_id = ? LIMIT 1`,
    [req.params.id]
  );
  if (rows.length === 0) fail(404, 'Submission not found.');
  if (req.user.role === 'Supervisor' && String(rows[0].supervisor_id) !== String(req.user.id)) {
    fail(403, 'You can only review submissions from your own team.');
  }
  await db.query(
    'UPDATE assignment_submissions SET status = ?, feedback = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE submission_id = ?',
    [status, feedback || null, req.user.id, req.params.id]
  );
  res.json({ message: 'Review saved.' });
}));

module.exports = router;