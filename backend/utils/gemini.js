// ============================================================
// Gemini AI helper
// Calls Google's Gemini API directly over REST (no extra SDK
// dependency to keep the project light and easy to audit).
//
// Docs:   https://ai.google.dev/gemini-api/docs
// Get a key: https://aistudio.google.com/apikey
// ============================================================

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Send a conversation to Gemini and get the mentor's reply.
 *
 * @param {string} systemPrompt - instructions for how the AI should behave
 * @param {Array<{sender: 'user'|'ai', content: string}>} history - prior turns, oldest first
 * @returns {Promise<string>} the AI's reply text
 */
async function askGemini(systemPrompt, history) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it to backend/.env'
    );
  }

  const contents = history.map((turn) => ({
    role: turn.sender === 'ai' ? 'model' : 'user',
    parts: [{ text: turn.content }]
  }));

  const url = `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Gemini API error (HTTP ${response.status})`;
    throw new Error(message);
  }

  const reply = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

  if (!reply) {
    // Model returned no text (e.g. blocked by safety filters)
    const reason = data?.candidates?.[0]?.finishReason;
    throw new Error(reason ? `Gemini did not return a reply (${reason}).` : 'Gemini did not return a reply.');
  }

  return reply.trim();
}

module.exports = { askGemini };
