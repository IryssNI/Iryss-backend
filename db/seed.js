require('dotenv').config();

const bcrypt = require('bcrypt');
const db = require('../src/config/database');

async function seed() {
  console.log('[Seed] Starting...');

  // Create test practice
  const passwordHash = await bcrypt.hash('Password123', 12);

  const practiceResult = await db.query(
    `INSERT INTO practices (name, email, password_hash, pms_type, sms_sender_name, digest_email_time)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    ['Bright Eyes Opticians', 'test@brighteyes.co.uk', passwordHash, 'Optix', 'Bright Eyes', '18:00']
  );

  const practiceId = practiceResult.rows[0].id;
  console.log(`[Seed] Practice created/updated — ID: ${practiceId}`);

  // Delete existing patients for this practice
  await db.query('DELETE FROM patients WHERE practice_id = $1', [practiceId]);

  const today = new Date();

  function daysAgo(n) {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  const patients = [
    // --- HIGH RISK: contact lens, >42 days since reorder ---
    {
      name: 'Alice Thornton',
      phone: '+447700900001',
      last_reorder_date: daysAgo(60),
      last_appointment_date: daysAgo(200),
      patient_type: 'contact_lens',
    },
    {
      name: 'Ben Marshall',
      phone: '+447700900002',
      last_reorder_date: daysAgo(75),
      last_appointment_date: daysAgo(400),
      patient_type: 'contact_lens',
    },
    {
      name: 'Clara Hughes',
      phone: '+447700900003',
      last_reorder_date: daysAgo(50),
      last_appointment_date: daysAgo(180),
      patient_type: 'contact_lens',
    },
    {
      name: 'Dylan Reeves',
      phone: '+447700900004',
      last_reorder_date: daysAgo(90),
      last_appointment_date: null,
      patient_type: 'contact_lens',
    },
    {
      name: 'Eleanor Scott',
      phone: '+447700900005',
      last_reorder_date: daysAgo(55),
      last_appointment_date: daysAgo(300),
      patient_type: 'contact_lens',
    },

    // --- HIGH RISK: general, missed appointment + no reorder ---
    {
      name: 'Finn Gallagher',
      phone: '+447700900006',
      last_reorder_date: null,
      last_appointment_date: daysAgo(400),
      patient_type: 'general',
    },
    {
      name: 'Grace O\'Brien',
      phone: '+447700900007',
      last_reorder_date: daysAgo(45),
      last_appointment_date: daysAgo(500),
      patient_type: 'general',
    },
    {
      name: 'Harry Patel',
      phone: '+447700900008',
      last_reorder_date: null,
      last_appointment_date: null,
      patient_type: 'general',
    },
    {
      name: 'Isla Morrison',
      phone: '+447700900009',
      last_reorder_date: daysAgo(48),
      last_appointment_date: daysAgo(420),
      patient_type: 'general',
    },
    {
      name: 'Jack Foster',
      phone: '+447700900010',
      last_reorder_date: null,
      last_appointment_date: daysAgo(380),
      patient_type: 'general',
    },

    // --- MEDIUM RISK: 28–42 days since reorder ---
    {
      name: 'Katie Walsh',
      phone: '+447700900011',
      last_reorder_date: daysAgo(35),
      last_appointment_date: daysAgo(90),
      patient_type: 'contact_lens',
    },
    {
      name: 'Liam Brennan',
      phone: '+447700900012',
      last_reorder_date: daysAgo(30),
      last_appointment_date: daysAgo(120),
      patient_type: 'contact_lens',
    },
    {
      name: 'Mia Henderson',
      phone: '+447700900013',
      last_reorder_date: daysAgo(40),
      last_appointment_date: daysAgo(60),
      patient_type: 'general',
    },
    {
      name: 'Noah Carter',
      phone: '+447700900014',
      last_reorder_date: daysAgo(28),
      last_appointment_date: daysAgo(180),
      patient_type: 'general',
    },
    {
      name: 'Olivia Brooks',
      phone: '+447700900015',
      last_reorder_date: daysAgo(38),
      last_appointment_date: daysAgo(100),
      patient_type: 'contact_lens',
    },

    // --- LOW RISK: <28 days since reorder / recent appointment ---
    {
      name: 'Patrick Daly',
      phone: '+447700900016',
      last_reorder_date: daysAgo(10),
      last_appointment_date: daysAgo(30),
      patient_type: 'contact_lens',
    },
    {
      name: 'Quinn Flanagan',
      phone: '+447700900017',
      last_reorder_date: daysAgo(5),
      last_appointment_date: daysAgo(14),
      patient_type: 'general',
    },
    {
      name: 'Rachel Simmons',
      phone: '+447700900018',
      last_reorder_date: daysAgo(20),
      last_appointment_date: daysAgo(45),
      patient_type: 'contact_lens',
    },
    {
      name: 'Sam Whitfield',
      phone: '+447700900019',
      last_reorder_date: daysAgo(15),
      last_appointment_date: daysAgo(60),
      patient_type: 'general',
    },
    {
      name: 'Tara Nolan',
      phone: '+447700900020',
      last_reorder_date: daysAgo(7),
      last_appointment_date: daysAgo(20),
      patient_type: 'contact_lens',
    },
  ];

  const { runRiskScoring } = require('../src/services/riskScoring');

  for (const p of patients) {
    const daysSinceReorder = p.last_reorder_date
      ? Math.floor((Date.now() - new Date(p.last_reorder_date).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    await db.query(
      `INSERT INTO patients
         (practice_id, name, phone, last_reorder_date, last_appointment_date, days_since_reorder, patient_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [practiceId, p.name, p.phone, p.last_reorder_date, p.last_appointment_date, daysSinceReorder, p.patient_type]
    );
  }

  console.log(`[Seed] Inserted ${patients.length} patients`);

  // Run risk scoring to populate scores
  await runRiskScoring();

  console.log('[Seed] Complete.');
  console.log('');
  console.log('  Test practice credentials:');
  console.log('    Email:    test@brighteyes.co.uk');
  console.log('    Password: Password123');

  await db.end();
}

seed().catch(err => {
  console.error('[Seed] Failed:', err.message);
  process.exit(1);
});
