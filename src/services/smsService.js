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
  const isContactLens = patient.patient_type === 'contact_lens';
  const isHigh = patient.risk_status === 'high';

  if (isHigh && isContactLens) {
    return `Hi ${firstName} 👋\n\nWe just wanted to check in — it's been a little while since you last reordered your contact lenses and we want to make sure you're getting on okay.\n\nWhenever you're ready, just reply to this message and we'll get everything sorted for you.\n\n${practiceName}`;
  }

  if (isHigh && !isContactLens) {
    return `Hi ${firstName} 👋\n\nIt's been a little while since we last saw you at ${practiceName}, and we just wanted to check in.\n\nIf you're due a check-up or have any questions about your eyes or glasses, we're always here. Just reply to this message or give us a call.`;
  }

  if (!isHigh && isContactLens) {
    return `Hi ${firstName},\n\nJust a gentle heads-up from ${practiceName} — it might be about time to think about reordering your contact lenses.\n\nNo rush at all, but if you'd like us to sort that for you, just reply here and we'll take care of it 😊`;
  }

  // medium, general
  return `Hi ${firstName},\n\nJust a friendly note from ${practiceName} — it might be worth thinking about booking a check-up soon.\n\nWhenever suits you, just reply to this message or give us a call and we'll find a time that works.`;
}

function buildLowRiskCheckinMessage(patient, practiceName) {
  const firstName = patient.name.split(' ')[0];
  return `Hi ${firstName} 👋\n\nJust a little hello from everyone at ${practiceName} — we hope you're keeping well.\n\nWe're always here if you ever need anything, whether that's a check-up, a lens reorder, or just a question. No pressure at all — just wanted you to know we're thinking of you.`;
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
      `SELECT p.id, p.name, p.phone, p.patient_type, p.risk_status
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
