const cron = require('node-cron');
const { runRiskScoring } = require('../services/riskScoring');
const { runSMSCampaign, runLowRiskCheckinCampaign, runReviewRequestCampaign, runReviewFollowupCampaign } = require('../services/smsService');
const { sendDailyDigest } = require('../services/emailService');

function initCronJobs() {
  // Risk scoring — daily at 02:00
  cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Starting risk scoring');
    try {
      await runRiskScoring();
    } catch (err) {
      console.error('[Cron] Risk scoring failed:', err.message);
    }
  }, { timezone: 'Europe/London' });

  // SMS campaign — daily at 09:00 (after risk scoring)
  cron.schedule('0 9 * * *', async () => {
    console.log('[Cron] Starting SMS campaign');
    try {
      await runSMSCampaign();
    } catch (err) {
      console.error('[Cron] SMS campaign failed:', err.message);
    }
  }, { timezone: 'Europe/London' });

  // Low-risk check-in campaign — 1st of every month at 09:00
  cron.schedule('0 9 1 * *', async () => {
    console.log('[Cron] Starting low-risk check-in campaign');
    try {
      await runLowRiskCheckinCampaign();
    } catch (err) {
      console.error('[Cron] Low-risk check-in campaign failed:', err.message);
    }
  }, { timezone: 'Europe/London' });

  // Review request campaign — daily at 11:00 (targets yesterday's appointments)
  cron.schedule('0 11 * * *', async () => {
    console.log('[Cron] Starting review request campaign');
    try {
      await runReviewRequestCampaign();
    } catch (err) {
      console.error('[Cron] Review request campaign failed:', err.message);
    }
  }, { timezone: 'Europe/London' });

  // Review followup campaign — daily at 14:00 (nudges 48h-old review requests)
  cron.schedule('0 14 * * *', async () => {
    console.log('[Cron] Starting review followup campaign');
    try {
      await runReviewFollowupCampaign();
    } catch (err) {
      console.error('[Cron] Review followup campaign failed:', err.message);
    }
  }, { timezone: 'Europe/London' });

  // Daily digest email — daily at 18:00
  cron.schedule('0 18 * * *', async () => {
    console.log('[Cron] Sending daily digest');
    try {
      await sendDailyDigest();
    } catch (err) {
      console.error('[Cron] Daily digest failed:', err.message);
    }
  }, { timezone: 'Europe/London' });

  console.log('[Cron] Jobs scheduled: risk scoring 02:00, SMS campaign 09:00, low-risk check-in 09:00 on 1st, review request 11:00, review followup 14:00, digest 18:00 (Europe/London)');
}

module.exports = { initCronJobs };
