// ============================================================
// Shared frontend helpers: talking to the API, auth, branding.
// Included on every page via <script src=".../assets/js/api.js">
// ============================================================

// 👉 Point this at your deployed backend. Left as-is, it assumes
//    the API runs on the same machine at port 3000 (local dev).
const API_BASE_URL = window.LMS_API_BASE_URL || 'https://learning-management-system-v-1.onrender.com/api';

// ---------------- Auth storage ----------------
function getToken() { return localStorage.getItem('lms_token'); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('lms_user') || 'null'); }
  catch { return null; }
}
function setSession(token, user) {
  localStorage.setItem('lms_token', token);
  localStorage.setItem('lms_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('lms_token');
  localStorage.removeItem('lms_user');
}
function logout() {
  clearSession();
  window.location.href = resolvePath('login.html');
}

// Figures out the relative path back to /login.html from any page depth
function resolvePath(target) {
  const depth = window.location.pathname.split('/').filter(Boolean);
  const inRoleFolder = depth.some((seg) => ['admin', 'supervisor', 'trainee'].includes(seg));
  return inRoleFolder ? `../${target}` : target;
}

// ---------------- API calls ----------------
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    token ? { Authorization: `Bearer ${token}` } : {},
    options.headers || {}
  );

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401 && !path.startsWith('/auth/login')) {
  clearSession();
  window.location.href = resolvePath('login.html');
  throw new Error('Session expired.');
}

  const isExcel = response.headers.get('content-type')?.includes('spreadsheet');
  if (isExcel) return response; // caller handles the blob

  let data = {};
  try { data = await response.json(); } catch { /* empty body */ }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

// Triggers a file download for report endpoints that return an .xlsx stream
async function downloadReport(path, filename) {
  const response = await apiFetch(path);
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// ---------------- Page guard ----------------
// Call at the top of every protected page: requireAuth(['Admin'])
function requireAuth(allowedRoles) {
  const token = getToken();
  const user = getUser();
  if (!token || !user) {
    window.location.href = resolvePath('login.html');
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    window.location.href = resolvePath(`${user.role.toLowerCase()}/dashboard.html`);
    return null;
  }
  const nameEl = document.getElementById('currentUserName');
  const roleEl = document.getElementById('currentUserRole');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role;
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  return user;
}

// ---------------- Branding (company name / logo) ----------------
async function applyBranding() {
  try {
    const settings = await apiFetch('/settings');
    if (settings.company_name) {
      document.querySelectorAll('.brand-name-slot').forEach((el) => (el.textContent = settings.company_name));
      document.title = document.title.replace('Enterprise LMS', settings.company_name);
    }
    if (settings.logo_url) {
      document.querySelectorAll('.brand-logo-slot').forEach((el) => (el.src = settings.logo_url));
    }
    if (settings.primary_color) {
      document.documentElement.style.setProperty('--primary', settings.primary_color);
    }
  } catch {
    // Branding is a nice-to-have; ignore failures (e.g. backend not running yet)
  }
}
document.addEventListener('DOMContentLoaded', applyBranding);

// ---------------- Small utilities ----------------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function statusBadgeClass(status) {
  const map = {
    Completed: 'badge-success',
    'In Progress': 'badge-info',
    Enrolled: 'badge-neutral',
    'Pending Request': 'badge-warning',
    Published: 'badge-success',
    Draft: 'badge-neutral',
    Archived: 'badge-danger',
    active: 'badge-success',
    inactive: 'badge-danger'
  };
  return map[status] || 'badge-neutral';
}
function showAlert(containerEl, message, type = 'error') {
  containerEl.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
  containerEl.classList.remove('hidden');
}


// Small pop-up message (bottom-right) for "Saved" / error feedback
function toast(message, type = 'success') {
  let box = document.getElementById('toastBox');
  if (!box) { box = document.createElement('div'); box.id = 'toastBox'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
