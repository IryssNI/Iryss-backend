const twilio = require('twilio');
const db = require('../config/database');

let twilioClient;

function getClient() {
  if (!twilioClient) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

function buildMessage(patient, practiceName) {
  const senderName = practiceName;
  const link = process.env.APP_URL || 'https://iryss.co.uk';

  if (patient.patient_type === 'contact_lens') {
    return `Hi ${patient.name.split(' ')[0]}, it's ${senderName}. We noticed you might be due a contact lens reorder — tap here to get in touch: ${link}`;
  }

  return `Hi ${patient.name.split(' ')[0]}, it's ${senderName}. We wanted to check in — it's been a while since your last visit. Reply to this message or call us to book.`;
}

/**
 * Send an SMS to a patient and log to messages table.
 */
async function sendPatientSMS(patient, practice) {
  const client = getClient();
  const messageBody = buildMessage(patient, practice.sms_sender_name || practice.name);

  await client.messages.create({
    body: messageBody,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: patient.phone,
  });

  await db.query(
    `INSERT INTO messages (patient_id, practice_id, message_body, direction, sent_at)
     VALUES ($1, $2, $3, 'outbound', NOW())`,
    [patient.id, practice.id, messageBody]
  );
}

/**
 * Run outbound SMS campaign for all high/medium risk patients
 * who haven't been messaged in 7 days.
 */
async function runSMSCampaign() {
  const practicesResult = await db.query(
    'SELECT id, name, sms_sender_name FROM practices'
  );

  let sent = 0;
  let errors = 0;

  for (const practice of practicesResult.rows) {
    const patientsResult = await db.query(
      `SELECT p.id, p.name, p.phone, p.patient_type
       FROM patients p
       WHERE p.practice_id = $1
         AND p.risk_status IN ('high', 'medium')
         AND p.phone IS NOT NULL
         AND p.phone != ''
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.patient_id = p.id
             AND m.direction = 'outbound'
             AND m.sent_at > NOW() - INTERVAL '7 days'
         )`,
      [practice.id]
    );

    for (const patient of patientsResult.rows) {
      try {
        await sendPatientSMS(patient, practice);
        sent++;
      } catch {
        errors++;
      }
    }
  }

  console.log(`[SMS Campaign] Sent: ${sent}, Errors: ${errors}`);
  return { sent, errors };
}

module.exports = { sendPatientSMS, runSMSCampaign };
