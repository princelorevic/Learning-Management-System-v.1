// ============================================================
// Shared helpers for showing course units.
// Used by admin/course-builder.html and trainee/learn.html
// Exposes one global: CourseRender
// ============================================================
(function (w) {
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const isHttp = (u) => /^https?:\/\/[^\s<>"']+$/i.test(String(u || '').trim());

  // label + icon for every unit type
  const TYPES = {
    lesson:       { label: 'Text',               icon: '📝' },
    web:          { label: 'Web content',        icon: '🌐' },
    video:        { label: 'Video',              icon: '🎬' },
    audio:        { label: 'Audio',              icon: '🎧' },
    presentation: { label: 'Presentation',       icon: '📊' },
    document:     { label: 'Document',           icon: '📄' },
    iframe:       { label: 'Frame',              icon: '</>' },
    quiz:         { label: 'Test',               icon: '✅' },
    survey:       { label: 'Survey',             icon: '📋' },
    assignment:   { label: 'Assignment',         icon: '📥' },
    ilt:          { label: 'Instructor-led',     icon: '🧑‍🏫' },
    section:      { label: 'Section',            icon: '§' }
  };
  const typeInfo = (t) => TYPES[t] || { label: 'Unit', icon: '📄' };

  // ---------------- text (rich text from the editor, or old plain text) ----------------
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'HR', 'SPAN', 'DIV', 'CODE', 'PRE']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'IMG', 'VIDEO', 'AUDIO']);

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString('<div>' + String(html || '') + '</div>', 'text/html');
    const root = doc.body.firstChild;
    (function clean(node) {
      Array.from(node.childNodes).forEach((ch) => {
        if (ch.nodeType === 3) return;
        if (ch.nodeType !== 1) { ch.remove(); return; }
        if (DROP.has(ch.tagName)) { ch.remove(); return; }
        if (!ALLOWED.has(ch.tagName)) { clean(ch); ch.replaceWith(...Array.from(ch.childNodes)); return; }
        Array.from(ch.attributes).forEach((a) => { if (!(ch.tagName === 'A' && a.name === 'href')) ch.removeAttribute(a.name); });
        if (ch.tagName === 'A') {
          const href = (ch.getAttribute('href') || '').trim();
          if (/^(https?:|mailto:)/i.test(href)) { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener noreferrer'); }
          else ch.removeAttribute('href');
        }
        clean(ch);
      });
    })(root);
    return root.innerHTML;
  }

  // Old units stored plain text; new ones store HTML from the editor.
  function textHtml(content) {
    const c = String(content || '');
    if (!c.trim()) return '';
    if (/<\/?[a-z][\s\S]*>/i.test(c)) return sanitizeHtml(c);
    return esc(c).replace(/\r?\n/g, '<br>');
  }

  // ---------------- embeds ----------------
  function googleEmbed(url) {
    let m;
    if ((m = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) return 'https://docs.google.com/presentation/d/' + m[1] + '/embed?start=false&loop=false&delayms=3000';
    if ((m = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/))) return 'https://docs.google.com/document/d/' + m[1] + '/preview';
    if ((m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) return 'https://docs.google.com/spreadsheets/d/' + m[1] + '/preview';
    if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) return 'https://drive.google.com/file/d/' + m[1] + '/preview';
    if ((m = url.match(/drive\.google\.com\/open\?(?:.*&)?id=([\w-]+)/))) return 'https://drive.google.com/file/d/' + m[1] + '/preview';
    return null;
  }

  function embedFor(type, url) {
    let m;
    const g = googleEmbed(url);
    if (type === 'video') {
      if ((m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i))) return { kind: 'iframe', src: 'https://www.youtube.com/embed/' + m[1] + '?rel=0', ratio: true };
      if ((m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i))) return { kind: 'iframe', src: 'https://player.vimeo.com/video/' + m[1], ratio: true };
      if ((m = url.match(/loom\.com\/share\/([\w-]+)/i))) return { kind: 'iframe', src: 'https://www.loom.com/embed/' + m[1], ratio: true };
      if (g) return { kind: 'iframe', src: g, ratio: true };
      if (/\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url)) return { kind: 'video', src: url };
      return { kind: 'iframe', src: url, ratio: true };
    }
    if (type === 'audio') {
      if (/\.(mp3|wav|ogg|oga|m4a|aac)(\?|#|$)/i.test(url)) return { kind: 'audio', src: url };
      return { kind: 'iframe', src: g || url, short: true };
    }
    if (type === 'presentation' || type === 'document') {
      const ratio = type === 'presentation';
      if (g) return { kind: 'iframe', src: g, ratio };
      if (/\.(pptx?|docx?|xlsx?)(\?|#|$)/i.test(url)) return { kind: 'iframe', src: 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(url), ratio };
      return { kind: 'iframe', src: url, ratio };
    }
    return { kind: 'iframe', src: url, sandbox: true }; // web, iframe
  }

  const openLink = (url) => '<p class="cr-open">Not showing? <a href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer">Open in a new tab ↗</a></p>';
  const empty = (msg) => '<div class="cr-empty">' + esc(msg) + '</div>';

  function mediaHtml(type, url) {
    if (!isHttp(url)) return empty('Nothing added yet.');
    const e = embedFor(type, url.trim());
    if (e.kind === 'video') return '<video class="cr-video" controls preload="metadata" src="' + escAttr(e.src) + '"></video>' + openLink(url);
    if (e.kind === 'audio') return '<div class="cr-audio"><audio controls preload="metadata" src="' + escAttr(e.src) + '"></audio></div>' + openLink(url);
    const cls = e.ratio ? 'ratio' : e.short ? 'short' : 'tall';
    const sb = e.sandbox ? ' sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"' : '';
    return '<div class="cr-frame ' + cls + '"><iframe src="' + escAttr(e.src) + '"' + sb +
      ' allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin" title="Unit content"></iframe></div>' + openLink(url);
  }

  // ---------------- instructor-led session ----------------
  function niceDate(d) {
    if (!d) return '';
    const dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  function niceTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h)) return t;
    return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function iltHtml(unit) {
    const s = unit.settings || {};
    const facts = [];
    if (s.date) facts.push(['Date', niceDate(s.date)]);
    if (s.start_time) facts.push(['Time', niceTime(s.start_time) + (s.end_time ? ' – ' + niceTime(s.end_time) : '')]);
    if (s.location) facts.push(['Location', s.location]);
    if (s.instructor) facts.push(['Instructor', s.instructor]);
    const cards = facts.length
      ? '<div class="cr-facts">' + facts.map((f) => '<div class="cr-fact"><small>' + esc(f[0]) + '</small><strong>' + esc(f[1]) + '</strong></div>').join('') + '</div>'
      : '';
    const link = isHttp(s.meeting_link)
      ? '<p style="margin:0 0 16px;"><a class="btn btn-primary" href="' + escAttr(s.meeting_link) + '" target="_blank" rel="noopener noreferrer">Join the session ↗</a></p>'
      : '';
    const desc = unit.content ? '<div class="cr-text">' + textHtml(unit.content) + '</div>' : '';
    return cards + link + desc || empty('Session details have not been added yet.');
  }

  // ---------------- the body of a unit (the parts that need no interaction) ----------------
  function bodyHtml(unit) {
    switch (unit.module_type) {
      case 'lesson': return unit.content ? '<div class="cr-text">' + textHtml(unit.content) + '</div>' : empty('No text added yet.');
      case 'section': return unit.content ? '<div class="cr-text">' + textHtml(unit.content) + '</div>' : '';
      case 'video': return unit.video_url ? mediaHtml('video', unit.video_url) : empty('No video link added yet.');
      case 'audio':
      case 'presentation':
      case 'document':
      case 'web':
      case 'iframe': return unit.resource_url ? mediaHtml(unit.module_type, unit.resource_url) : empty('No link added yet.');
      case 'ilt': return iltHtml(unit);
      default: return '';
    }
  }

  w.CourseRender = { esc, escAttr, isHttp, TYPES, typeInfo, sanitizeHtml, textHtml, mediaHtml, bodyHtml, embedFor };
})(window);