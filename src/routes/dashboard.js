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

// GET /api/dashboard/at-risk — full list of high+medium risk patients with revenue impact
router.get('/at-risk', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;

    const result = await db.query(
      `SELECT
         p.id, p.name, p.phone, p.risk_status, p.days_since_reorder,
         p.last_appointment_date, p.patient_type,
         CEIL(COALESCE(p.days_since_reorder, 30) / 30.0) * ${AVG_PATIENT_VALUE} AS revenue_at_risk
       FROM patients p
       WHERE p.practice_id = $1
         AND p.risk_status IN ('high', 'medium')
       ORDER BY p.risk_score DESC, p.days_since_reorder DESC NULLS LAST`,
      [practiceId]
    );

    res.json({ patients: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/recovered — patients recovered this month with trigger info
router.get('/recovered', async (req, res, next) => {
  try {
    const practiceId = req.practice.id;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const result = await db.query(
      `SELECT
         p.id, p.name,
         MIN(m.sent_at) AS recovered_at,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM messages im
             WHERE im.patient_id = p.id AND im.direction = 'inbound'
               AND im.sentiment = 'positive' AND im.sent_at >= $2
           ) THEN 'Replied positively'
           WHEN EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.patient_id = p.id AND a.created_at >= $2
           ) THEN 'Booked appointment'
           ELSE 'Re-engaged via message'
         END AS trigger,
         ${AVG_PATIENT_VALUE} AS revenue_recovered
       FROM patients p
       INNER JOIN messages m ON m.patient_id = p.id
       WHERE p.practice_id = $1
         AND p.risk_status = 'low'
         AND m.direction = 'outbound'
         AND m.sent_at >= $2
       GROUP BY p.id, p.name
       ORDER BY MIN(m.sent_at) DESC`,
      [practiceId, monthStart]
    );

    res.json({ patients: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
