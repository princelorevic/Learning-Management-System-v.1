// ============================================================
// Small input-validation helpers shared by the API routes.
// ============================================================

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Accepts only http(s) links. Returns the cleaned URL string, or null when empty.
// A missing scheme ("example.com/x") is assumed to be https.
// Anything like "javascript:..." / "data:..." is rejected, so a saved link can
// never run script when somebody clicks it.
function normalizeUrl(input, label = 'Link') {
  if (input === undefined || input === null) return null;
  let s = String(input).trim();
  if (!s) return null;
  if (s.length > 1000) throw httpError(400, `${label} is too long.`);
  if (/^(javascript|data|vbscript|file|blob|about):/i.test(s)) {
    throw httpError(400, `${label} must start with http:// or https://`);
  }
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let url;
  try {
    url = new URL(s);
  } catch {
    throw httpError(400, `${label} is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw httpError(400, `${label} must start with http:// or https://`);
  }
  return s;
}

// Sends the right response for an error thrown by httpError(); returns true if handled.
function sendHttpError(res, error) {
  if (error && error.status) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

module.exports = { httpError, normalizeUrl, sendHttpError };
