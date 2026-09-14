// ============================================================
// Creates (or resets the password of) the first Admin account.
// Run with:  npm run seed
// Uses SEED_ADMIN_* values from your .env file — nothing is
// hardcoded here, so it's safe to keep this file in git.
// ============================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const bcrypt = require('bcryptjs');
const db = require('./config/db');

async function seedAdmin() {
  const name = process.env.SEED_ADMIN_NAME || 'System Admin';
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password || password.length < 8) {
    console.error('❌ Set SEED_ADMIN_PASSWORD in your .env file (min 8 characters) before seeding.');
    process.exit(1);
  }

  try {
    const [roleRows] = await db.query("SELECT role_id FROM roles WHERE role_name = 'Admin' LIMIT 1");
    if (roleRows.length === 0) {
      console.error('❌ No "Admin" role found. Run database/schema.sql first.');
      process.exit(1);
    }

    const hashed = await bcrypt.hash(password, 10);

    await db.query(
      `INSERT INTO users (name, username, password, role_id, status)
       VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE password = VALUES(password), name = VALUES(name)`,
      [name, username, hashed, roleRows[0].role_id]
    );

    console.log(`✅ Admin account ready. Username: "${username}" — sign in and change the password.`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
}

seedAdmin();
