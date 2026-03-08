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
      { role: 'user', content: messageText },
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
 * Formats patient data for inclusion in the system prompt.
 */
function formatPatientContext(patient) {
  const lines = [
    `- Name: ${patient.name}`,
    `- Patient type: ${patient.patient_type === 'contact_lens' ? 'Contact lens wearer' : 'General patient'}`,
  ];

  if (patient.last_reorder_date) {
    const days = patient.days_since_reorder;
    lines.push(`- Last contact lens reorder: ${days} days ago (${new Date(patient.last_reorder_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })})`);
  } else {
    lines.push(`- Last contact lens reorder: no record`);
  }

  if (patient.last_appointment_date) {
    const apptDays = Math.floor((Date.now() - new Date(patient.last_appointment_date).getTime()) / (1000 * 60 * 60 * 24));
    lines.push(`- Last appointment: ${apptDays} days ago (${new Date(patient.last_appointment_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })})`);
  } else {
    lines.push(`- Last appointment: no record`);
  }

  lines.push(`- Engagement status: ${patient.risk_status === 'high' ? 'High risk — significantly overdue' : patient.risk_status === 'medium' ? 'Medium risk — due for follow-up' : 'Low risk — up to date'}`);

  return lines.join('\n');
}

/**
 * Generates a proactive AI receptionist reply with full patient context.
 *
 * Returns:
 * {
 *   reply: string,
 *   book_appointment: { date: string, time: string } | null,
 *   save_feedback: string | null
 * }
 */
async function generateReply(practice, patient, conversationHistory, currentMessage) {
  const openai = getClient();

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const systemPrompt = `You are a warm, professional AI receptionist for ${practice.name}, an independent opticians in the UK.

PATIENT RECORD:
${formatPatientContext(patient)}

AVAILABLE APPOINTMENT SLOTS:
Monday to Saturday, 9am–5pm on the hour, for the next 2 weeks from today (${today}).
When offering slots, suggest 2–3 specific dates and times. Use natural UK date format (e.g. "Monday 16th March at 10am").

YOUR GOALS:
1. Help the patient reorder contact lenses or book an appointment
2. Naturally gather feedback — ask why they haven't been in recently, how their lenses or glasses are working for them, any issues with comfort, vision or dryness, and whether they'd recommend the practice to friends or family
3. Proactively suggest an appointment if their last visit was more than 6 months ago or there is no record of one

BEHAVIOUR:
- Be warm, concise and conversational — like a real receptionist who already knows this patient
- Never say you are an AI
- Never make up clinical information or prescription details
- For urgent eye health concerns, always advise the patient to call the practice directly or go to A&E immediately
- For contact lens reorders, tell the patient that someone from the practice will call them to process the order
- When you confirm a booking, clearly state the date and time in your reply

RESPONSE FORMAT — you must always respond with valid JSON and nothing else:
{
  "reply": "your conversational message to the patient",
  "book_appointment": { "date": "YYYY-MM-DD", "time": "HH:00" },
  "save_feedback": "concise summary of any meaningful feedback the patient shared"
}

Rules:
- "reply" is always required
- Set "book_appointment" ONLY when the patient has explicitly confirmed a specific date and time — otherwise null
- Set "save_feedback" ONLY when the patient has shared meaningful feedback about their experience, lenses, vision, or the practice — otherwise null`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: currentMessage },
    ],
  });

  const content = response.choices[0].message.content.trim();
  const parsed = JSON.parse(content);

  return {
    reply: parsed.reply || '',
    book_appointment: parsed.book_appointment || null,
    save_feedback: parsed.save_feedback || null,
  };
}

module.exports = { analyseReply, generateReply };
