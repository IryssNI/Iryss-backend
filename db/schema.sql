-- Iryss Database Schema

CREATE TABLE IF NOT EXISTS practices (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  pms_type VARCHAR(100),
  sms_sender_name VARCHAR(50),
  digest_email_time VARCHAR(10) DEFAULT '18:00',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  last_reorder_date DATE,
  last_appointment_date DATE,
  days_since_reorder INTEGER,
  risk_score INTEGER DEFAULT 0,
  risk_status VARCHAR(20) DEFAULT 'low',
  patient_type VARCHAR(20) DEFAULT 'general',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_practice_id ON patients(practice_id);
CREATE INDEX IF NOT EXISTS idx_patients_risk_status ON patients(risk_status);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practice_id INTEGER NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  message_body TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  sentiment VARCHAR(20) CHECK (sentiment IN ('positive', 'negative', 'urgent')),
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_patient_id ON messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_messages_practice_id ON messages(practice_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  practice_id INTEGER NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  alert_type VARCHAR(100),
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_practice_id ON alerts(practice_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);

CREATE TABLE IF NOT EXISTS revenue_tracking (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  patients_at_risk INTEGER DEFAULT 0,
  patients_recovered INTEGER DEFAULT 0,
  revenue_at_risk DECIMAL(10,2) DEFAULT 0,
  revenue_recovered DECIMAL(10,2) DEFAULT 0,
  UNIQUE (practice_id, month)
);
