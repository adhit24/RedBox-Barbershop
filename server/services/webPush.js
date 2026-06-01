const webpush = require('web-push');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@redbox.id',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * Send Web Push to a single subscription
 */
async function sendPush(sub, payload) {
  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
}

/**
 * Send Web Push to all subscriptions for a user
 */
async function sendPushToUser(supabase, userId, payload) {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) return;
  await Promise.allSettled(subs.map((sub) => sendPush(sub, payload)));
}

/**
 * Send Web Push to all barbers in a branch
 */
async function sendPushToBranch(supabase, branch, payload) {
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('branch', branch)
    .eq('role', 'barber');

  if (!users) return;
  await Promise.allSettled(users.map((u) => sendPushToUser(supabase, u.id, payload)));
}

module.exports = { sendPush, sendPushToUser, sendPushToBranch };
