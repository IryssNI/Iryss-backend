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
  const isHigh = patient.risk_status === 'high';

  if (isHigh) {
    return `Hi ${firstName},\n\nIt's been a little while and we've been thinking about you — we just wanted to check in and see how you're doing.\n\nWhenever you're ready, we're here to help with whatever would be most useful — whether that's an updated eye check, a chat about your prescription, or just a general catch-up about your eye health. Absolutely no pressure at all.\n\nJust reply to us here and we'll take it from there 😊\n\n${practiceName}`;
  }

  // medium risk
  return `Hi ${firstName},\n\nWe just wanted to check in and see how you're getting on with your latest contact lens order.\n\nIt's always worth having an updated prescription to make sure you're in the right lenses — comfort and clarity can shift gradually and it's easy not to notice.\n\nWe're happy to help you review your lenses or pop in for a quick check-up if that would be useful. No pressure at all — just reply to us here whenever suits you 😊\n\n${practiceName}`;
}

function buildLowRiskCheckinMessage(patient, practiceName) {
  const firstName = patient.name.split(' ')[0];
  return `Hi ${firstName},\n\nWe just wanted to check in and see how you're getting on with your new contact lenses.\n\nHopefully comfort is good and you're happy with how you're seeing. If anything feels slightly off — dryness, blurry vision, any discomfort at all — it's always worth a quick chat and we're here to help.\n\nWe're happy to review your lenses or answer any questions, completely no pressure — just reply to us here anytime 😊\n\n${practiceName}`;
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

function buildReviewRequestMessage(patient, practice) {
  const firstName = patient.name.split(' ')[0];
  const practiceName = practice.sms_sender_name || practice.name;
  const reviewLink = practice.google_review_link || '';
  return `Hi ${firstName} 😊\n\nIt was so lovely to see you yesterday — we hope everything went well with your appointment.\n\nIf you have a moment, we'd really appreciate it if you could leave us a quick Google review. It makes such a difference to a small independent practice like ours.\n\n${reviewLink}\n\nThank you so much — see you next time! 💙\n${practiceName}`;
}

function buildReviewFollowupMessage(patient, practice) {
  const firstName = patient.name.split(' ')[0];
  const practiceName = practice.sms_sender_name || practice.name;
  const reviewLink = practice.google_review_link || '';
  return `Hi ${firstName},\n\nJust a gentle reminder from ${practiceName} — if you have 30 seconds to spare, a Google review would mean the world to us. 🙏\n\n${reviewLink}\n\nNo worries at all if not — hope you're keeping well!\n${practiceName}`;
}

/**
 * Run daily review request campaign — patients with appointments yesterday
 * who haven't received a review_request in the last 7 days.
 */
async function runReviewRequestCampaign() {
  const practicesResult = await db.query(
    `SELECT id, name, sms_sender_name, google_review_link
     FROM practices
     WHERE google_review_link IS NOT NULL AND google_review_link != ''`
  );

  let sent = 0;
  let errors = 0;

  for (const practice of practicesResult.rows) {
    const patientsResult = await db.query(
      `SELECT DISTINCT p.id, p.name, p.phone
       FROM patients p
       JOIN appointments a ON a.patient_id = p.id
       WHERE a.practice_id = $1
         AND a.proposed_date = CURRENT_DATE - INTERVAL '1 day'
         AND a.status = 'confirmed'
         AND p.phone IS NOT NULL
         AND p.phone != ''
         AND NOT EXISTS (
           SELECT 1 FROM messages m
           WHERE m.patient_id = p.id
             AND m.message_type = 'review_request'
             AND m.sent_at > NOW() - INTERVAL '7 days'
         )`,
      [practice.id]
    );

    for (const patient of patientsResult.rows) {
      try {
        const client = getClient();
        const messageBody = buildReviewRequestMessage(patient, practice);
        await client.messages.create({
          body: messageBody,
          from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
          to: `whatsapp:${patient.phone}`,
        });
        await db.query(
          `INSERT INTO messages (patient_id, practice_id, message_body, direction, message_type, sent_at)
           VALUES ($1, $2, $3, 'outbound', 'review_request', NOW())`,
          [patient.id, practice.id, messageBody]
        );
        sent++;
      } catch {
        errors++;
      }
    }
  }

  console.log(`[Review Request Campaign] Sent: ${sent}, Errors: ${errors}`);
  return { sent, errors };
}

/**
 * Run daily review followup campaign — patients who received a review_request
 * 48–72 hours ago and haven't received a review_followup yet.
 */
async function runReviewFollowupCampaign() {
  const practicesResult = await db.query(
    `SELECT id, name, sms_sender_name, google_review_link
     FROM practices
     WHERE google_review_link IS NOT NULL AND google_review_link != ''`
  );

  let sent = 0;
  let errors = 0;

  for (const practice of practicesResult.rows) {
    const patientsResult = await db.query(
      `SELECT DISTINCT p.id, p.name, p.phone
       FROM patients p
       JOIN messages m ON m.patient_id = p.id
       WHERE m.practice_id = $1
         AND m.message_type = 'review_request'
         AND m.direction = 'outbound'
         AND m.sent_at < NOW() - INTERVAL '48 hours'
         AND m.sent_at > NOW() - INTERVAL '72 hours'
         AND p.phone IS NOT NULL
         AND p.phone != ''
         AND NOT EXISTS (
           SELECT 1 FROM messages m2
           WHERE m2.patient_id = p.id
             AND m2.message_type = 'review_followup'
         )`,
      [practice.id]
    );

    for (const patient of patientsResult.rows) {
      try {
        const client = getClient();
        const messageBody = buildReviewFollowupMessage(patient, practice);
        await client.messages.create({
          body: messageBody,
          from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
          to: `whatsapp:${patient.phone}`,
        });
        await db.query(
          `INSERT INTO messages (patient_id, practice_id, message_body, direction, message_type, sent_at)
           VALUES ($1, $2, $3, 'outbound', 'review_followup', NOW())`,
          [patient.id, practice.id, messageBody]
        );
        sent++;
      } catch {
        errors++;
      }
    }
  }

  console.log(`[Review Followup Campaign] Sent: ${sent}, Errors: ${errors}`);
  return { sent, errors };
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

module.exports = { buildMessage, buildLowRiskCheckinMessage, sendPatientSMS, sendLowRiskCheckin, runSMSCampaign, runLowRiskCheckinCampaign, runReviewRequestCampaign, runReviewFollowupCampaign };
