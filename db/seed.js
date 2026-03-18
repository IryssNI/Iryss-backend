require('dotenv').config();

const bcrypt = require('bcrypt');
const db = require('../src/config/database');
const { runRiskScoring } = require('../src/services/riskScoring');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

async function seed() {
  console.log('[Seed] Clearing existing data...');
  await db.query('DELETE FROM alerts');
  await db.query('DELETE FROM messages');
  await db.query('DELETE FROM revenue_tracking');
  await db.query('DELETE FROM patients');
  await db.query('DELETE FROM practices');

  console.log('[Seed] Inserting practices...');
  const passwordHash = await bcrypt.hash('Password123', 12);

  const practices = [
    {
      name: 'Bright Eyes Opticians',
      email: 'test@brighteyes.co.uk',
      pms_type: 'Optix',
      sms_sender_name: 'BrightEyes',
    },
    {
      name: 'Harbour View Opticians',
      email: 'hello@harbourview-optics.co.uk',
      pms_type: 'Sightpro',
      sms_sender_name: 'HarbourView',
    },
    {
      name: 'Northern Quarter Opticians',
      email: 'info@nqopticians.co.uk',
      pms_type: 'Optix',
      sms_sender_name: 'NQ Opticians',
    },
    {
      name: 'Clifton Eye Care',
      email: 'team@cliftoneyecare.co.uk',
      pms_type: 'Crystal',
      sms_sender_name: 'CliftonEyes',
    },
    {
      name: 'Bay Opticians',
      email: 'contact@bayopticians.co.uk',
      pms_type: 'Sightpro',
      sms_sender_name: 'Bay Opticians',
    },
  ];

  const practiceIds = [];
  for (const p of practices) {
    const res = await db.query(
      `INSERT INTO practices (name, email, password_hash, pms_type, sms_sender_name, digest_email_time)
       VALUES ($1, $2, $3, $4, $5, '18:00') RETURNING id`,
      [p.name, p.email, passwordHash, p.pms_type, p.sms_sender_name]
    );
    practiceIds.push(res.rows[0].id);
  }

  console.log(`[Seed] Inserted ${practices.length} practices`);

  const [p1, p2, p3, p4, p5] = practiceIds;

  const patients = [
    // ── Bright Eyes Opticians (Edinburgh) ──────────────────────────────
    { practice_id: p1, name: 'Fiona Mackenzie',   phone: '+447700900001', last_reorder_date: daysAgo(50),  last_appointment_date: daysAgo(200), patient_type: 'contact_lens' },
    { practice_id: p1, name: 'Hamish Stewart',    phone: '+447700900002', last_reorder_date: null,          last_appointment_date: daysAgo(410), patient_type: 'general' },
    { practice_id: p1, name: 'Catriona Reid',     phone: '+447700900003', last_reorder_date: daysAgo(35),  last_appointment_date: daysAgo(95),  patient_type: 'contact_lens' },
    { practice_id: p1, name: 'Alasdair Murray',   phone: '+447700900004', last_reorder_date: daysAgo(30),  last_appointment_date: daysAgo(180), patient_type: 'general' },
    { practice_id: p1, name: 'Morag Campbell',    phone: '+447700900005', last_reorder_date: daysAgo(65),  last_appointment_date: daysAgo(280), patient_type: 'contact_lens' },
    { practice_id: p1, name: 'Euan Thomson',      phone: '+447700900006', last_reorder_date: daysAgo(10),  last_appointment_date: daysAgo(30),  patient_type: 'general' },
    { practice_id: p1, name: 'Isla Paterson',     phone: '+447700900007', last_reorder_date: daysAgo(20),  last_appointment_date: daysAgo(55),  patient_type: 'contact_lens' },
    { practice_id: p1, name: 'Duncan MacLeod',    phone: '+447700900008', last_reorder_date: null,          last_appointment_date: daysAgo(395), patient_type: 'general' },
    { practice_id: p1, name: 'Kirsty Fraser',     phone: '+447700900009', last_reorder_date: daysAgo(38),  last_appointment_date: daysAgo(110), patient_type: 'contact_lens' },
    { practice_id: p1, name: 'Ross Henderson',    phone: '+447700900010', last_reorder_date: daysAgo(5),   last_appointment_date: daysAgo(22),  patient_type: 'general' },

    // ── Harbour View Opticians (Belfast) ───────────────────────────────
    { practice_id: p2, name: "Siobhan O'Neill",   phone: '+447700900011', last_reorder_date: daysAgo(55),  last_appointment_date: daysAgo(230), patient_type: 'contact_lens' },
    { practice_id: p2, name: 'Ciaran Murphy',     phone: '+447700900012', last_reorder_date: daysAgo(33),  last_appointment_date: daysAgo(140), patient_type: 'general' },
    { practice_id: p2, name: 'Aoife Doherty',     phone: '+447700900013', last_reorder_date: daysAgo(15),  last_appointment_date: daysAgo(60),  patient_type: 'contact_lens' },
    { practice_id: p2, name: 'Declan McAllister', phone: '+447700900014', last_reorder_date: null,          last_appointment_date: daysAgo(510), patient_type: 'general' },
    { practice_id: p2, name: 'Niamh Gallagher',   phone: '+447700900015', last_reorder_date: daysAgo(42),  last_appointment_date: daysAgo(175), patient_type: 'contact_lens' },
    { practice_id: p2, name: 'Conor Bradley',     phone: '+447700900016', last_reorder_date: daysAgo(7),   last_appointment_date: daysAgo(18),  patient_type: 'general' },
    { practice_id: p2, name: 'Roisin Maguire',    phone: '+447700900017', last_reorder_date: daysAgo(48),  last_appointment_date: daysAgo(260), patient_type: 'contact_lens' },
    { practice_id: p2, name: 'Padraig Quinn',     phone: '+447700900018', last_reorder_date: daysAgo(12),  last_appointment_date: daysAgo(45),  patient_type: 'general' },
    { practice_id: p2, name: 'Orlaith McGrath',   phone: '+447700900019', last_reorder_date: daysAgo(28),  last_appointment_date: daysAgo(130), patient_type: 'contact_lens' },
    { practice_id: p2, name: 'Eamonn Fitzpatrick',phone: '+447700900020', last_reorder_date: daysAgo(22),  last_appointment_date: daysAgo(75),  patient_type: 'general' },

    // ── Northern Quarter Opticians (Manchester) ────────────────────────
    { practice_id: p3, name: 'Priya Patel',       phone: '+447700900021', last_reorder_date: daysAgo(60),  last_appointment_date: daysAgo(310), patient_type: 'contact_lens' },
    { practice_id: p3, name: 'Mohammed Hussain',  phone: '+447700900022', last_reorder_date: daysAgo(36),  last_appointment_date: daysAgo(155), patient_type: 'general' },
    { practice_id: p3, name: 'Sophie Williams',   phone: '+447700900023', last_reorder_date: daysAgo(18),  last_appointment_date: daysAgo(50),  patient_type: 'contact_lens' },
    { practice_id: p3, name: 'Amir Khan',         phone: '+447700900024', last_reorder_date: null,          last_appointment_date: daysAgo(385), patient_type: 'general' },
    { practice_id: p3, name: 'Chloe Robinson',    phone: '+447700900025', last_reorder_date: daysAgo(44),  last_appointment_date: daysAgo(190), patient_type: 'contact_lens' },
    { practice_id: p3, name: 'Tyler Booth',       phone: '+447700900026', last_reorder_date: daysAgo(8),   last_appointment_date: daysAgo(25),  patient_type: 'general' },
    { practice_id: p3, name: 'Yasmin Akhtar',     phone: '+447700900027', last_reorder_date: daysAgo(31),  last_appointment_date: daysAgo(120), patient_type: 'contact_lens' },
    { practice_id: p3, name: 'Joshua Taylor',     phone: '+447700900028', last_reorder_date: null,          last_appointment_date: daysAgo(430), patient_type: 'general' },
    { practice_id: p3, name: 'Emma Clarke',       phone: '+447700900029', last_reorder_date: daysAgo(25),  last_appointment_date: daysAgo(80),  patient_type: 'contact_lens' },
    { practice_id: p3, name: 'Liam Walsh',        phone: '+447700900030', last_reorder_date: daysAgo(40),  last_appointment_date: daysAgo(165), patient_type: 'general' },

    // ── Clifton Eye Care (Bristol) ─────────────────────────────────────
    { practice_id: p4, name: 'Olivia Barnes',     phone: '+447700900031', last_reorder_date: daysAgo(52),  last_appointment_date: daysAgo(245), patient_type: 'contact_lens' },
    { practice_id: p4, name: 'George Ashworth',   phone: '+447700900032', last_reorder_date: daysAgo(29),  last_appointment_date: daysAgo(100), patient_type: 'general' },
    { practice_id: p4, name: 'Amelia Thornton',   phone: '+447700900033', last_reorder_date: daysAgo(14),  last_appointment_date: daysAgo(42),  patient_type: 'contact_lens' },
    { practice_id: p4, name: 'Harry Blackwell',   phone: '+447700900034', last_reorder_date: null,          last_appointment_date: daysAgo(455), patient_type: 'general' },
    { practice_id: p4, name: 'Poppy Griffiths',   phone: '+447700900035', last_reorder_date: daysAgo(39),  last_appointment_date: daysAgo(150), patient_type: 'contact_lens' },
    { practice_id: p4, name: 'Freddie Hopkins',   phone: '+447700900036', last_reorder_date: daysAgo(6),   last_appointment_date: daysAgo(20),  patient_type: 'general' },
    { practice_id: p4, name: 'Isabella Price',    phone: '+447700900037', last_reorder_date: daysAgo(58),  last_appointment_date: daysAgo(290), patient_type: 'contact_lens' },
    { practice_id: p4, name: 'Charlie Stone',     phone: '+447700900038', last_reorder_date: daysAgo(21),  last_appointment_date: daysAgo(70),  patient_type: 'general' },
    { practice_id: p4, name: 'Daisy Carpenter',   phone: '+447700900039', last_reorder_date: daysAgo(34),  last_appointment_date: daysAgo(135), patient_type: 'contact_lens' },
    { practice_id: p4, name: 'Jack Morrison',     phone: '+447700900040', last_reorder_date: daysAgo(47),  last_appointment_date: daysAgo(210), patient_type: 'general' },

    // ── Bay Opticians (Cardiff) ────────────────────────────────────────
    { practice_id: p5, name: 'Rhys Davies',       phone: '+447700900041', last_reorder_date: daysAgo(63),  last_appointment_date: daysAgo(320), patient_type: 'contact_lens' },
    { practice_id: p5, name: 'Cerys Evans',       phone: '+447700900042', last_reorder_date: daysAgo(27),  last_appointment_date: daysAgo(90),  patient_type: 'general' },
    { practice_id: p5, name: 'Gareth Morgan',     phone: '+447700900043', last_reorder_date: daysAgo(37),  last_appointment_date: daysAgo(145), patient_type: 'contact_lens' },
    { practice_id: p5, name: 'Seren Jones',       phone: '+447700900044', last_reorder_date: null,          last_appointment_date: daysAgo(600), patient_type: 'general' },
    { practice_id: p5, name: 'Owain Williams',    phone: '+447700900045', last_reorder_date: daysAgo(16),  last_appointment_date: daysAgo(48),  patient_type: 'contact_lens' },
    { practice_id: p5, name: 'Bethan Thomas',     phone: '+447700900046', last_reorder_date: daysAgo(43),  last_appointment_date: daysAgo(195), patient_type: 'general' },
    { practice_id: p5, name: 'Rhodri Lewis',      phone: '+447700900047', last_reorder_date: daysAgo(32),  last_appointment_date: daysAgo(125), patient_type: 'contact_lens' },
    { practice_id: p5, name: 'Nia Roberts',       phone: '+447700900048', last_reorder_date: daysAgo(9),   last_appointment_date: daysAgo(28),  patient_type: 'general' },
    { practice_id: p5, name: 'Dylan Hughes',      phone: '+447700900049', last_reorder_date: daysAgo(55),  last_appointment_date: daysAgo(265), patient_type: 'contact_lens' },
    { practice_id: p5, name: 'Megan Price',       phone: '+447700900050', last_reorder_date: daysAgo(26),  last_appointment_date: daysAgo(85),  patient_type: 'general' },
  ];

  for (const p of patients) {
    await db.query(
      `INSERT INTO patients
         (practice_id, name, phone, last_reorder_date, last_appointment_date, days_since_reorder, patient_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [p.practice_id, p.name, p.phone, p.last_reorder_date, p.last_appointment_date, daysSince(p.last_reorder_date), p.patient_type]
    );
  }

  console.log(`[Seed] Inserted ${patients.length} patients`);

  await runRiskScoring();

  // Print summary
  const counts = await db.query(
    `SELECT risk_status, COUNT(*) FROM patients GROUP BY risk_status ORDER BY risk_status`
  );
  console.log('[Seed] Risk distribution:');
  counts.rows.forEach(r => console.log(`  ${r.risk_status}: ${r.count} patients`));

  console.log('\n[Seed] Complete.');
  console.log('\n  Practice login credentials (all use Password123):');
  practices.forEach(p => console.log(`  ${p.name.padEnd(32)} ${p.email}`));

  await db.end();
}

seed().catch(err => {
  console.error('[Seed] Failed:', err.message);
  process.exit(1);
});
