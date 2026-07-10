/**
 * api/paypal-webhook.js
 * PayPal calls this URL whenever a subscription event happens (activated,
 * cancelled, payment made, payment failed, expired, etc). We verify the
 * event really came from PayPal, then update the user's Firestore profile
 * with admin privileges (bypassing the normal Firestore rules, which
 * intentionally block users from writing these fields themselves).
 *
 * Register this URL in the PayPal dashboard (Apps & Credentials -> your
 * app -> Add Webhook) AFTER deploying, as:
 *   https://YOUR-PROJECT.vercel.app/api/paypal-webhook
 * Subscribe it to at least:
 *   BILLING.SUBSCRIPTION.ACTIVATED
 *   BILLING.SUBSCRIPTION.CANCELLED
 *   BILLING.SUBSCRIPTION.EXPIRED
 *   BILLING.SUBSCRIPTION.SUSPENDED
 *   PAYMENT.SALE.COMPLETED
 */

const { getFirebaseAdmin, getPayPalAccessToken, PAYPAL_API, planKeyFromPlanId } = require("./_lib");

const ONE_MONTH_MS = 31 * 24 * 60 * 60 * 1000; // small buffer over 30 days so a slightly-late renewal doesn't lapse a user early

async function verifyWebhookSignature(headers, body) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: body
    })
  });
  const data = await res.json();
  return data.verification_status === "SUCCESS";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const event = req.body;

  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, event);
  } catch (e) {
    console.error("Webhook verification error:", e.message);
  }
  if (!verified) {
    console.warn("Rejected webhook: signature verification failed.");
    res.status(400).send("Signature verification failed");
    return;
  }

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const eventType = event.event_type;
  const resource = event.resource || {};

  try {
    if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED" || eventType === "PAYMENT.SALE.COMPLETED") {
      // For PAYMENT.SALE.COMPLETED, the subscription id is under billing_agreement_id
      // instead of resource.id directly.
      const subscriptionId = resource.id && resource.id.startsWith("I-")
        ? resource.id
        : resource.billing_agreement_id;

      if (!subscriptionId) {
        console.warn("No subscription id found on event, skipping:", eventType);
        res.status(200).send("OK (no subscription id, ignored)");
        return;
      }

      // Look up the subscription directly from PayPal to get plan_id + custom_id
      // reliably, rather than trusting fields that vary by event type.
      const token = await getPayPalAccessToken();
      const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const sub = await subRes.json();
      const uid = sub.custom_id;
      const planKey = planKeyFromPlanId(sub.plan_id);

      if (!uid || !planKey) {
        console.warn("Could not resolve uid/planKey for subscription", subscriptionId);
        res.status(200).send("OK (unresolved uid/plan, ignored)");
        return;
      }

      const expiresAtField = planKey === "vip" ? "vipExpiresAt" : "noAdsExpiresAt";
      const subscriptionIdField = planKey === "vip" ? "vipSubscriptionId" : "noAdsSubscriptionId";

      await db.collection("users").doc(uid).set({
        [expiresAtField]: Date.now() + ONE_MONTH_MS,
        [subscriptionIdField]: subscriptionId
      }, { merge: true });

      console.log(`Updated ${planKey} for user ${uid}, expires in ~1 month.`);
    }

    else if (
      eventType === "BILLING.SUBSCRIPTION.CANCELLED" ||
      eventType === "BILLING.SUBSCRIPTION.EXPIRED" ||
      eventType === "BILLING.SUBSCRIPTION.SUSPENDED"
    ) {
      const subscriptionId = resource.id;
      const planKey = planKeyFromPlanId(resource.plan_id);
      const uid = resource.custom_id;

      if (uid && planKey) {
        // We intentionally do NOT zero out expiresAt here — the user keeps
        // access until their already-paid-for period naturally ends
        // (isVipActive/isNoAdsActive already check expiresAt vs now).
        // We just clear the subscriptionId so the Store page knows to show
        // "Subscribe" again instead of "Cancel subscription" once expired.
        const subscriptionIdField = planKey === "vip" ? "vipSubscriptionId" : "noAdsSubscriptionId";
        await db.collection("users").doc(uid).set({
          [subscriptionIdField]: null
        }, { merge: true });
        console.log(`Cleared ${subscriptionIdField} for user ${uid} (${eventType}).`);
      }
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("Webhook handling error:", e.message);
    // Return 200 anyway once verified — returning an error tells PayPal to
    // retry, which could double-process; log it and investigate manually
    // instead of relying on automatic retries for logic errors.
    res.status(200).send("Handled with errors, see logs");
  }
};
