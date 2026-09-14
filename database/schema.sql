-- ============================================================
-- Enterprise Learning Management System
-- Database Schema (MySQL 8 / MySQL Workbench compatible)
-- ============================================================
-- How to use:
--   1. Open MySQL Workbench, connect to your server.
--   2. File > Run SQL Script... > select this file, OR paste
--      into a query tab and run the whole script (lightning bolt icon).
--   3. This creates its own database (enterprise_lms) and all tables.
-- ============================================================

CREATE DATABASE IF NOT EXISTS enterprise_lms
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE enterprise_lms;

-- ------------------------------------------------------------
-- ROLES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  role_id INT AUTO_INCREMENT PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO roles (role_name)
  SELECT * FROM (SELECT 'Admin' AS role_name UNION SELECT 'Supervisor' UNION SELECT 'Trainee') AS seed
  WHERE NOT EXISTS (SELECT 1 FROM roles WHERE roles.role_name = seed.role_name);

-- ------------------------------------------------------------
-- USERS  (admin, supervisor, trainee all live here; role_id decides which)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role_id INT NOT NULL,
  supervisor_id INT NULL,                         -- trainee -> their supervisor
  department VARCHAR(100) NULL,
  learning_style VARCHAR(50) DEFAULT 'Not Assessed',
  gem_link VARCHAR(500) NULL,                      -- optional: link to a custom Gemini Gem for this trainee
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(role_id),
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_users_supervisor (supervisor_id),
  INDEX idx_users_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- COURSES / TRAININGS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  course_id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  department_target VARCHAR(100) NOT NULL DEFAULT 'ALL',
  status ENUM('Draft','Published','Archived') NOT NULL DEFAULT 'Draft',
  duration_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Course content, ordered into simple modules/lessons
CREATE TABLE IF NOT EXISTS course_modules (
  module_id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which supervisors are allowed to deliver/conduct a given course
CREATE TABLE IF NOT EXISTS course_facilitators (
  course_id INT NOT NULL,
  supervisor_id INT NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, supervisor_id),
  FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- ENROLLMENTS  (a trainee taking a course)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
  enrollment_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  course_id INT NOT NULL,
  status ENUM('Pending Request','Enrolled','In Progress','Completed') NOT NULL DEFAULT 'Enrolled',
  progress DECIMAL(5,2) NOT NULL DEFAULT 0,
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  assigned_by INT NULL,
  UNIQUE KEY unique_enrollment (user_id, course_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(course_id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_enroll_user (user_id),
  INDEX idx_enroll_course (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- CERTIFICATES  (issued automatically when an enrollment completes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificates (
  certificate_id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  certificate_code VARCHAR(50) NOT NULL UNIQUE,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(enrollment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- AI MENTOR
-- ------------------------------------------------------------
-- Single row of global settings: the instructions admin writes for
-- how the AI mentor should teach ALL trainees.
CREATE TABLE IF NOT EXISTS ai_settings (
  id INT PRIMARY KEY DEFAULT 1,
  mentor_name VARCHAR(100) NOT NULL DEFAULT 'AI Learning Mentor',
  -- 'gem_link'  = free: admin creates a Gemini Gem by hand and pastes its link per trainee (users.gem_link)
  -- 'api_chat'  = live in-app chat, calls the Gemini API using GEMINI_API_KEY (usage-based cost)
  mode ENUM('gem_link','api_chat') NOT NULL DEFAULT 'gem_link',
  system_prompt TEXT,
  provider VARCHAR(50) NOT NULL DEFAULT 'gemini',
  model VARCHAR(100) NOT NULL DEFAULT 'gemini-flash-latest',
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO ai_settings (id, system_prompt)
  SELECT 1, 'You are a friendly, patient corporate training mentor. Explain concepts clearly, check for understanding, and encourage the employee.'
  WHERE NOT EXISTS (SELECT 1 FROM ai_settings WHERE id = 1);

CREATE TABLE IF NOT EXISTS ai_conversations (
  conversation_id INT AUTO_INCREMENT PRIMARY KEY,
  trainee_id INT NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trainee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_messages (
  message_id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender ENUM('user','ai') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(conversation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- WHITE-LABEL / SYSTEM SETTINGS  (company name, logo, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_settings (setting_key, setting_value)
  SELECT * FROM (
    SELECT 'company_name' AS setting_key, 'Your Company' AS setting_value
    UNION SELECT 'logo_url', '/assets/images/logo.png'
    UNION SELECT 'primary_color', '#2563eb'
  ) AS seed
  WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE system_settings.setting_key = seed.setting_key);
