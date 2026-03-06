const db = require('../config/database');

function computeRisk(patient) {
  const days = patient.days_since_reorder;
  const lastAppt = patient.last_appointment_date ? new Date(patient.last_appointment_date) : null;
  const daysSinceAppt = lastAppt
    ? Math.floor((Date.now() - lastAppt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const missedAppointment = daysSinceAppt === null || daysSinceAppt > 365;

  // Start with reorder-based score
  let score = 0;
  let status = 'low';

  if (days !== null) {
    if (days > 42) {
      score = Math.min(100, 80 + Math.floor((days - 42) / 2));
      status = 'high';
    } else if (days >= 28) {
      score = 50 + Math.floor((days - 28) * 1.875);
      status = 'medium';
    } else {
      score = Math.floor(days * 1.5);
      status = 'low';
    }
  }

  // Boost for missed appointment
  if (missedAppointment) {
    if (status === 'medium' || (status === 'low' && days !== null && days > 14)) {
      score = Math.min(100, score + 20);
      status = 'high';
    } else if (status === 'low') {
      score = Math.min(49, score + 15);
    }
  }

  return { score, status };
}

/**
 * Runs the risk scoring engine across all patients.
 * Updates days_since_reorder, risk_score, and risk_status.
 */
async function runRiskScoring() {
  const result = await db.query(`
    SELECT id, last_reorder_date, last_appointment_date
    FROM patients
  `);

  let updated = 0;

  for (const patient of result.rows) {
    const daysSinceReorder = patient.last_reorder_date
      ? Math.floor((Date.now() - new Date(patient.last_reorder_date).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const { score, status } = computeRisk({
      ...patient,
      days_since_reorder: daysSinceReorder,
    });

    await db.query(
      `UPDATE patients
       SET days_since_reorder = $1,
           risk_score = $2,
           risk_status = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [daysSinceReorder, score, status, patient.id]
    );

    updated++;
  }

  console.log(`[Risk Scoring] Updated ${updated} patients`);
  return { updated };
}

module.exports = { runRiskScoring, computeRisk };
