const express = require('express');
const db = require('../config/database');

const router = express.Router();

const AVG_PATIENT_VALUE = 150;

// GET /api/dashboard
router.get('/', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Patients at risk (high or medium)
    const atRiskResult = await db.query(
      `SELECT COUNT(*) FROM patients WHERE practice_id = $1 AND risk_status IN ('high', 'medium')`,
      [practiceId]
    );
    const patientsAtRisk = parseInt(atRiskResult.rows[0].count);

    // Patients recovered this month:
    // Had an outbound message this month AND now have low risk
    const recoveredResult = await db.query(
      `SELECT COUNT(DISTINCT p.id)
       FROM patients p
       INNER JOIN messages m ON m.patient_id = p.id
       WHERE p.practice_id = $1
         AND p.risk_status = 'low'
         AND m.direction = 'outbound'
         AND m.sent_at >= $2`,
      [practiceId, monthStart]
    );
    const patientsRecovered = parseInt(recoveredResult.rows[0].count);

    // Revenue figures
    const revenueAtRisk = patientsAtRisk * AVG_PATIENT_VALUE;
    const revenueRecovered = patientsRecovered * AVG_PATIENT_VALUE;

    // High risk patients with last message
    const highRiskResult = await db.query(
      `SELECT
         p.id, p.name, p.phone, p.days_since_reorder, p.risk_score,
         p.last_appointment_date, p.patient_type,
         m.message_body AS last_message,
         m.sent_at AS last_message_at,
         m.direction AS last_message_direction
       FROM patients p
       LEFT JOIN LATERAL (
         SELECT message_body, sent_at, direction
         FROM messages
         WHERE patient_id = p.id
         ORDER BY sent_at DESC
         LIMIT 1
       ) m ON true
       WHERE p.practice_id = $1 AND p.risk_status = 'high'
       ORDER BY p.risk_score DESC
       LIMIT 50`,
      [practiceId]
    );

    // Unresolved urgent alerts count
    const alertsResult = await db.query(
      `SELECT COUNT(*) FROM alerts WHERE practice_id = $1 AND resolved = false`,
      [practiceId]
    );
    const unresolvedAlerts = parseInt(alertsResult.rows[0].count);

    // Messages sent this week
    const weeklyMessagesResult = await db.query(
      `SELECT COUNT(*) FROM messages WHERE practice_id = $1 AND direction = 'outbound' AND sent_at >= $2`,
      [practiceId, weekAgo]
    );
    const messagesSentThisWeek = parseInt(weeklyMessagesResult.rows[0].count);

    // Update revenue_tracking for this month
    await db.query(
      `INSERT INTO revenue_tracking (practice_id, month, patients_at_risk, patients_recovered, revenue_at_risk, revenue_recovered)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (practice_id, month)
       DO UPDATE SET
         patients_at_risk = EXCLUDED.patients_at_risk,
         patients_recovered = EXCLUDED.patients_recovered,
         revenue_at_risk = EXCLUDED.revenue_at_risk,
         revenue_recovered = EXCLUDED.revenue_recovered`,
      [
        practiceId,
        monthStart.toISOString().split('T')[0],
        patientsAtRisk,
        patientsRecovered,
        revenueAtRisk,
        revenueRecovered,
      ]
    );

    res.json({
      summary: {
        patients_at_risk: patientsAtRisk,
        patients_recovered: patientsRecovered,
        revenue_at_risk: revenueAtRisk,
        revenue_recovered: revenueRecovered,
        unresolved_alerts: unresolvedAlerts,
        messages_sent_this_week: messagesSentThisWeek,
      },
      high_risk_patients: highRiskResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
