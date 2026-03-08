const OpenAI = require('openai');

let client;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Analyses a patient SMS reply and returns sentiment + summary.
 * Returns: { sentiment: 'positive'|'negative'|'urgent', summary: string }
 */
async function analyseReply(messageText) {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 150,
    messages: [
      {
        role: 'system',
        content: `You are analysing SMS replies from patients of an optical practice in the UK.
Classify the patient's message into exactly one of these sentiments:
- "positive": patient is engaging positively, wants to book, thanks the practice, or indicates they will reorder
- "negative": patient is opting out, says they have moved, are no longer a patient, or don't want contact
- "urgent": patient expresses distress, reports an eye emergency, urgent vision problem, or any medical concern

Also provide a one-sentence plain-English summary of what the patient said.

Respond ONLY with valid JSON in this exact format:
{"sentiment": "positive"|"negative"|"urgent", "summary": "one sentence summary"}`,
      },
      {
        role: 'user',
        content: messageText,
      },
    ],
  });

  const content = response.choices[0].message.content.trim();
  const parsed = JSON.parse(content);

  if (!['positive', 'negative', 'urgent'].includes(parsed.sentiment)) {
    throw new Error('Unexpected sentiment value from OpenAI');
  }

  return { sentiment: parsed.sentiment, summary: parsed.summary };
}

/**
 * Generates a conversational AI reply on behalf of the practice.
 * @param {string} practiceName
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - chronological conversation history
 * @param {string} currentMessage - the patient's latest message
 * @returns {string} AI-generated reply
 */
async function generateReply(practiceName, history, currentMessage) {
  const openai = getClient();

  const systemPrompt = `You are a friendly, helpful assistant for ${practiceName}, an independent opticians. You help patients with contact lens reorders, booking appointments, answering questions about eye care, and general queries. You are warm, concise and professional. Never make up clinical information. If a patient has an urgent eye health concern, always advise them to call the practice directly or go to A&E. Sign off messages naturally — never say you are an AI.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 300,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: currentMessage },
    ],
  });

  return response.choices[0].message.content.trim();
}

module.exports = { analyseReply, generateReply };
