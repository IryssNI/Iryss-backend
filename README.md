# Iryss Backend

Patient retention system for independent optical practices in the UK and Ireland.

Iryss identifies at-risk patients based on behavioural signals, sends personalised SMS re-engagement messages via Twilio, analyses replies with OpenAI, and delivers a daily digest email summarising recovered revenue.

---

## Tech Stack

- **Node.js** with Express
- **PostgreSQL** database
- **Twilio** — outbound SMS + inbound webhook
- **OpenAI** — reply sentiment analysis
- **Nodemailer** — daily digest emails
- **JWT** — practice authentication
- **node-cron** — scheduled jobs
- **Render** — deployment target

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret key for JWT signing (min 32 chars) |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number (E.164 format, e.g. `+441234567890`) |
| `OPENAI_API_KEY` | OpenAI API key |
| `SMTP_HOST` | SMTP server host (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | SMTP port (`587` for TLS, `465` for SSL) |
| `SMTP_USER` | SMTP username / email address |
| `SMTP_PASS` | SMTP password or app password |
| `SMTP_FROM` | From name and address (e.g. `Iryss <noreply@iryss.co.uk>`) |
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default: `3000`) |
| `APP_URL` | Public URL of the app (used in SMS links and email buttons) |

---

## Running Locally

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your values

# 3. Create the database
createdb iryss

# 4. Run the schema
npm run db:schema

# 5. Seed with test data
npm run db:seed

# 6. Start the development server
npm run dev
```

The server starts on `http://localhost:3000`.

---

## CSV Import Format

`POST /api/patients/import` accepts a CSV file with these columns (header row required):

```
name,phone,last_reorder_date,last_appointment_date,patient_type
Alice Thornton,+447700900001,2024-01-15,2023-06-10,contact_lens
Ben Marshall,+447700900002,,,general
```

- `patient_type`: `contact_lens` or `general` (defaults to `general`)
- Dates: `YYYY-MM-DD` format
- Phone: E.164 format recommended (e.g. `+447700900001`)

---

## API Reference

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | Public | Register a new practice |
| POST | `/api/auth/login` | Public | Login, receive JWT |

### Patients

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/patients/import` | JWT | Upload CSV of patients |
| GET | `/api/patients` | JWT | List patients (filter by `risk_status`) |
| GET | `/api/patients/:id` | JWT | Get patient + message history |

### Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard` | JWT | Summary stats + high-risk patient list |

### Alerts

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/alerts` | JWT | List unresolved urgent alerts |
| POST | `/api/alerts/:id/resolve` | JWT | Mark alert as resolved |

### Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/settings` | JWT | Get practice settings |
| PUT | `/api/settings` | JWT | Update name, email, SMS sender, digest time, password |

### Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/twilio/inbound` | Twilio signature | Receive inbound SMS replies |

---

## Scheduled Jobs (node-cron, Europe/London)

| Time | Job |
|---|---|
| 02:00 daily | Risk scoring — recalculates `days_since_reorder`, `risk_score`, `risk_status` for all patients |
| 09:00 daily | SMS campaign — sends personalised SMS to high/medium risk patients not messaged in 7 days |
| 18:00 daily | Daily digest email — sends summary to every practice |

---

## Risk Scoring Logic

| Condition | Status | Score |
|---|---|---|
| `days_since_reorder` > 42 | `high` | 80–100 |
| `days_since_reorder` 28–42 | `medium` | 50–79 |
| No appointment in 12+ months AND `days_since_reorder` > 14 | `high` | boosted +20 |
| `days_since_reorder` < 28 | `low` | 0–42 |

---

## Deploying to Render

1. Create a new **Web Service** and connect your repository
2. Set **Build Command**: `npm install`
3. Set **Start Command**: `npm start`
4. Add all environment variables in the Render dashboard
5. Create a **PostgreSQL** database in Render and copy the connection string to `DATABASE_URL`
6. After first deploy, run the schema via Render Shell: `npm run db:schema`
7. Configure Twilio inbound webhook URL: `https://your-app.onrender.com/webhooks/twilio/inbound`

---

## GDPR Notes

- No patient PII (names, phone numbers, message content) is written to application logs
- All patient data is scoped to the practice via `practice_id` on every query
- Practices can delete their own data via cascade-delete on the `practices` table
- Passwords are hashed with bcrypt (12 rounds)
- JWT tokens expire after 7 days
