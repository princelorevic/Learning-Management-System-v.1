# Enterprise Learning Management System

A ready-to-deploy LMS with three roles — **Admin**, **Supervisor**, **Trainee** —
built on HTML5/CSS/JavaScript (frontend) and Node.js/Express + MySQL (backend),
with an AI mentor for trainees and one-click Excel reports.

Tested end-to-end before delivery: schema, every API route, role-based access
control, Excel report generation, and every page all ran successfully against a
live MySQL database.

---

## 1. What's included

- **Admin** — create/edit accounts, create trainings (with modules), assign
  supervisors to conduct a training, enroll trainees, a dashboard (total
  accounts, trainings, completion %), one-click Excel reports (trainees /
  supervisors / trainings), and AI mentor configuration.
- **Supervisor** — dashboard of their team (active / ongoing / completed),
  a team roster, the ability to conduct admin-created trainings and update
  their team's progress, and an Excel export of their team's report.
- **Trainee** — dashboard (enrolled / completed / pending), browse and
  request trainings, track their own progress, and chat with an AI mentor.
- **White-label** — company name, logo, and brand color are editable from
  Admin → Settings, so you can re-skin this for any company.

## 2. Folder structure

```
enterprise-lms/
├── database/schema.sql        ← run this first (MySQL Workbench or CLI)
├── backend/                   ← Node.js + Express API
│   ├── .env.example           ← copy to .env and fill in your values
│   ├── routes/                ← one file per feature area
│   ├── seed.js                ← creates your first Admin login
│   └── server.js
└── frontend/                  ← static HTML/CSS/JS, deployable anywhere
    ├── login.html
    ├── admin/  supervisor/  trainee/
    └── assets/
```

## 3. Set up the database

1. Open **MySQL Workbench**, connect to your server.
2. Open `database/schema.sql` and run the whole script (the ⚡ "Execute" button).
   This creates the `enterprise_lms` database and every table, already seeded
   with the 3 roles and sensible defaults.

## 4. Set up the backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` — your MySQL credentials.
  Set `DB_USE_SSL=true` if your host requires it (most cloud MySQL providers do).
- `JWT_SECRET` — any long random string (the file shows a command to generate one).
- `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` — your first login. Then run:
  ```bash
  npm run seed
  ```
- `GEMINI_API_KEY` — only needed if you turn on **live AI chat** (see §6). Get a
  free key at https://aistudio.google.com/apikey. Not required for the default
  Gem-link mode.

Start the server:
```bash
npm start
```
It runs on `http://localhost:3000` by default (`PORT` in `.env`).

## 5. Set up the frontend

The frontend is plain static files — open `frontend/login.html` with any static
host (Firebase Hosting, Netlify, Vercel, S3, nginx, or even a local dev server).

Before deploying, point it at your backend: open `frontend/assets/js/api.js`
and change the first line's fallback, **or** (recommended, no code edits)
add this one line before it in each HTML page's `<head>`, or just once in
`login.html` and each dashboard if you serve them from the same origin:
```html
<script>window.LMS_API_BASE_URL = "https://your-backend-domain.com/api";</script>
```
Also add your frontend's URL to `CORS_ORIGIN` in the backend's `.env`.

**To use your own logo:** replace `frontend/assets/images/logo.png` before
deploying — simplest option. Company name, a hosted logo URL, and brand color
are also editable live from **Admin → Settings**.

## 6. AI Mentor — two modes (Admin → Settings)

- **Gem link (default, free)** — you create a personalized Gem in
  [Gemini](https://gemini.google.com) using the instructions box on this
  page, then paste the Gem's share link onto each trainee's account
  (Admin → Accounts → edit trainee → "Gemini Gem link"). The trainee's
  "AI Mentor" page just opens it.
- **Live in-app chat (optional, usage-based cost)** — a real chat, inside
  the app, backed by the Gemini API. Turn it on in Admin → Settings and set
  `GEMINI_API_KEY` in the backend's `.env`. Every trainee's chat automatically
  includes their name, department, and learning style, plus whatever
  instructions you write — so one prompt shapes how it teaches everyone.

## 7. Deploying

Any Node host works (Render, Railway, Fly.io, a VPS, etc.) for the backend,
and any static host for the frontend — your existing project was already set
up for Firebase Hosting (frontend) with the backend on Render, so that split
works as-is. Set the backend's environment variables in your host's dashboard
instead of committing `.env`.

## 8. Before you go live — please do this

**Rotate your database password.** While reviewing your uploaded project,
`backend/seed_admin.js` had a live database password hardcoded in it, and
your GitHub repo is public — so that password is currently exposed to anyone.
Change the password on your database provider now. The new `seed.js` in this
project reads everything from `.env`, which is git-ignored, so this shouldn't
recur.

Also change the seeded admin password after your first login, and never
commit a real `.env` file.

## 9. What's different from your original project

Your original had a solid start — working login/user/course endpoints, a nice
design system, and good AI-agent scaffolding — but several pieces were
placeholders: the "AI" scorer returned hardcoded canned answers, the AI chat
was simulated (`"I am currently in simulation mode"`), no endpoint required
login (anyone could call any API), and password hashes were returned to the
browser. This version keeps your stack, roles, and visual style, and makes
all of it real: enforced login + role checks on every route, live Excel
generation, a working AI mentor (either mode), and full CRUD across accounts,
trainings, modules, facilitators, and enrollment.
