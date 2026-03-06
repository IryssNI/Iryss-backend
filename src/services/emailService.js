const nodemailer = require('nodemailer');
const db = require('../config/database');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send urgent alert email to a practice when a patient reply is flagged.
 */
async function sendUrgentAlert(practice, patientName, summary) {
  const transport = getTransporter();

  await transport.sendMail({
    from: process.env.SMTP_FROM || 'Iryss <noreply@iryss.co.uk>',
    to: practice.email,
    subject: `Iryss — Urgent patient reply requires attention`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#c0392b">Urgent Patient Reply</h2>
        <p>A patient at <strong>${practice.name}</strong> has sent a message that requires immediate attention.</p>
        <div style="background:#fff3f3;border-left:4px solid #c0392b;padding:12px 16px;margin:16px 0">
          <p style="margin:0"><strong>Patient:</strong> ${patientName}</p>
          <p style="margin:8px 0 0"><strong>Summary:</strong> ${summary}</p>
        </div>
        <p>Please log in to your Iryss dashboard to view the full message and resolve this alert.</p>
        <a href="${process.env.APP_URL || '#'}"
           style="display:inline-block;background:#2c3e50;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px">
          View Dashboard
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px">Iryss — Patient Retention for Optical Practices</p>
      </div>
    `,
  });
}

/**
 * Send daily digest email to all practices.
 */
async function sendDailyDigest() {
  const transport = getTransporter();
  const practicesResult = await db.query('SELECT id, name, email FROM practices');
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let sent = 0;
  let errors = 0;

  for (const practice of practicesResult.rows) {
    try {
      // At-risk count
      const atRiskResult = await db.query(
        `SELECT COUNT(*) FROM patients WHERE practice_id = $1 AND risk_status IN ('high', 'medium')`,
        [practice.id]
      );
      const atRisk = parseInt(atRiskResult.rows[0].count);

      // Urgent unresolved alerts
      const urgentResult = await db.query(
        `SELECT a.id, p.name AS patient_name, m.message_body
         FROM alerts a
         INNER JOIN patients p ON p.id = a.patient_id
         LEFT JOIN LATERAL (
           SELECT message_body FROM messages
           WHERE patient_id = a.patient_id AND direction = 'inbound'
           ORDER BY sent_at DESC LIMIT 1
         ) m ON true
         WHERE a.practice_id = $1 AND a.resolved = false
         ORDER BY a.created_at DESC`,
        [practice.id]
      );

      // Re-engaged this week (outbound message + now low risk)
      const reengagedResult = await db.query(
        `SELECT COUNT(DISTINCT p.id)
         FROM patients p
         INNER JOIN messages m ON m.patient_id = p.id
         WHERE p.practice_id = $1
           AND p.risk_status = 'low'
           AND m.direction = 'outbound'
           AND m.sent_at >= $2`,
        [practice.id, weekAgo]
      );
      const reengaged = parseInt(reengagedResult.rows[0].count);

      // Revenue recovered this month
      const recoveredResult = await db.query(
        `SELECT COUNT(DISTINCT p.id)
         FROM patients p
         INNER JOIN messages m ON m.patient_id = p.id
         WHERE p.practice_id = $1
           AND p.risk_status = 'low'
           AND m.direction = 'outbound'
           AND m.sent_at >= $2`,
        [practice.id, monthStart]
      );
      const recoveredCount = parseInt(recoveredResult.rows[0].count);
      const revenueRecovered = recoveredCount * 150;

      const urgentRows = urgentResult.rows;
      const urgentHtml = urgentRows.length > 0
        ? `<h3 style="color:#c0392b">Urgent Replies Needing Attention (${urgentRows.length})</h3>
           <ul>
             ${urgentRows.map(r => `<li><strong>${r.patient_name}</strong>${r.message_body ? ` — "${r.message_body}"` : ''}</li>`).join('')}
           </ul>`
        : `<p style="color:#27ae60">No urgent replies today.</p>`;

      await transport.sendMail({
        from: process.env.SMTP_FROM || 'Iryss <noreply@iryss.co.uk>',
        to: practice.email,
        subject: `Iryss Daily Digest — ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#2c3e50">Daily Digest — ${practice.name}</h2>
            <p>${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>

            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr>
                <td style="padding:12px;background:#f8f9fa;border:1px solid #dee2e6">
                  <strong style="color:#e74c3c">${atRisk}</strong><br><small>Patients at risk</small>
                </td>
                <td style="padding:12px;background:#f8f9fa;border:1px solid #dee2e6">
                  <strong style="color:#27ae60">${reengaged}</strong><br><small>Re-engaged this week</small>
                </td>
                <td style="padding:12px;background:#f8f9fa;border:1px solid #dee2e6">
                  <strong style="color:#2980b9">£${revenueRecovered.toLocaleString()}</strong><br><small>Revenue recovered this month</small>
                </td>
                <td style="padding:12px;background:#f8f9fa;border:1px solid #dee2e6">
                  <strong style="color:#c0392b">${urgentRows.length}</strong><br><small>Urgent replies</small>
                </td>
              </tr>
            </table>

            ${urgentHtml}

            <a href="${process.env.APP_URL || '#'}"
               style="display:inline-block;background:#2c3e50;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;margin-top:8px">
              Open Dashboard
            </a>
            <p style="color:#999;font-size:12px;margin-top:24px">Iryss — Patient Retention for Optical Practices</p>
          </div>
        `,
      });

      sent++;
    } catch {
      errors++;
    }
  }

  console.log(`[Digest] Sent: ${sent}, Errors: ${errors}`);
  return { sent, errors };
}

module.exports = { sendUrgentAlert, sendDailyDigest };
