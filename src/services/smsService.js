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
  const firstName = patient.name.split(' ')[0];

  if (patient.patient_type === 'contact_lens') {
    return `Hi ${firstName}, it's ${practiceName}. We noticed you haven't reordered your contact lenses lately — would you like to? Reply here or give us a call and we'll sort it for you.`;
  }

  return `Hi ${firstName}, it's ${practiceName}. We noticed it's been a while since your last visit — would you like to book in? Reply here or give us a call.`;
}

function buildLowRiskCheckinMessage(patient, practiceName) {
  const firstName = patient.name.split(' ')[0];
  return `Hi ${firstName}! 👋 Just a friendly note from ${practiceName} — we hope you're doing well. It's always worth keeping on top of your eye health, so whenever you're ready to book your next check-up, we're here. Just reply to this message and we'll get you sorted! 😊`;
}

/**
 * Send a WhatsApp message to a patient and log to messages table.
 */
async function sendPatientSMS(patient, practice, messageType = null) {
  const client = getClient();
  const messageBody = buildMessage(patient, practice.sms_sender_name || practice.name);

  await client.messages.create({
    body: messageBody,
    from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
    to: `whatsapp:${patient.phone}`,
  });

  await db.query(
    `INSERT INTO messages (patient_id, practice_id, message_body, direction, message_type, sent_at)
     VALUES ($1, $2, $3, 'outbound', $4, NOW())`,
    [patient.id, practice.id, messageBody, messageType]
  );
}

/**
 * Send a low-risk check-in WhatsApp message to a patient and log to messages table.
 */
async function sendLowRiskCheckin(patient, practice, messageType = 'low_risk_checkin') {
  const client = getClient();
  const messageBody = buildLowRiskCheckinMessage(patient, practice.sms_sender_name || practice.name);

  await client.messages.create({
    body: messageBody,
    from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
    to: `whatsapp:${patient.phone}`,
  });

  await db.query(
    `INSERT INTO messages (patient_id, practice_id, message_body, direction, message_type, sent_at)
     VALUES ($1, $2, $3, 'outbound', $4, NOW())`,
    [patient.id, practice.id, messageBody, messageType]
  );
}

/**
 * Run outbound WhatsApp campaign for all high/medium risk patients
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

/**
 * Run monthly low-risk check-in campaign.
 * Targets low-risk patients not contacted in the last 60 days.
 */
async function runLowRiskCheckinCampaign() {
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
         AND p.risk_status = 'low'
         AND p.phone IS NOT NULL
         AND p.phone != ''
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.patient_id = p.id
             AND m.direction = 'outbound'
             AND m.sent_at > NOW() - INTERVAL '60 days'
         )`,
      [practice.id]
    );

    for (const patient of patientsResult.rows) {
      try {
        await sendLowRiskCheckin(patient, practice, 'low_risk_checkin');
        sent++;
      } catch {
        errors++;
      }
    }
  }

  console.log(`[Low-Risk Check-in Campaign] Sent: ${sent}, Errors: ${errors}`);
  return { sent, errors };
}

module.exports = { buildLowRiskCheckinMessage, sendPatientSMS, sendLowRiskCheckin, runSMSCampaign, runLowRiskCheckinCampaign };
