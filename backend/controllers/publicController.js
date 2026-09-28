const pool = require('../config/db');

/**
 * PUBLIC endpoints — no JWT required. Only ever return safe, aggregate
 * counts here (never names, emails, amounts, or anything account-specific).
 * This powers the Statistics section on the public landing page.
 */

// GET /api/public/stats
exports.getStats = async (req, res) => {
  const safeCount = async (sql) => {
    try {
      const [rows] = await pool.query(sql);
      return rows[0].count;
    } catch {
      return 0;
    }
  };

  const [total_employees, total_products, total_customers, total_departments] = await Promise.all([
    safeCount(`SELECT COUNT(*) AS count FROM employees WHERE employment_status='active'`),
    safeCount(`SELECT COUNT(*) AS count FROM products WHERE status='active'`),
    safeCount(`SELECT COUNT(*) AS count FROM customers WHERE status='active'`),
    safeCount(`SELECT COUNT(*) AS count FROM departments WHERE status='active'`)
  ]);

  res.json({
    success: true,
    data: { total_employees, total_products, total_customers, total_departments }
  });
};