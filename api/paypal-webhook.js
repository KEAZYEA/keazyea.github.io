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
 *   PAYMENT.CAPTURE.COMPLETED   (token packs — see api/token-packs.js)
 * and, so refunds and chargebacks reach the admin (see recordPaymentAlert):
 *   PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED,
 *   PAYMENT.SALE.REFUNDED, PAYMENT.SALE.REVERSED, CUSTOMER.DISPUTE.CREATED
 */

const {
  getFirebaseAdmin, getPayPalAccessToken, PAYPAL_API, paypalJson, planKeyFromPlanId, TOKENS_PER_PAYMENT,
  parsePackCustomId, creditTokenPack, notifyPackCredited, getPack, ADMIN_UID
} = require("./_lib");
const { FieldValue } = require("firebase-admin/firestore");

const ONE_MONTH_MS = 31 * 24 * 60 * 60 * 1000; // small buffer over 30 days so a slightly-late renewal doesn't lapse a user early

// PayPal signs the exact bytes it sent, so the check must be given those
// bytes. A body that was parsed and re-serialised can differ in tiny ways
// (escaped "\/", number formatting) and then fails with FAILURE even though
// every setting is right — which is what happened in production. When the
// raw text is available it's spliced in untouched; otherwise the parsed
// object is sent as before.
async function verifyWebhookSignature(headers, body, rawBody) {
  const token = await getPayPalAccessToken();
  const PLACEHOLDER = "\"__KIH_RAW_WEBHOOK_EVENT__\"";
  let payload = JSON.stringify({
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: process.env.PAYPAL_WEBHOOK_ID,
    webhook_event: rawBody ? "__KIH_RAW_WEBHOOK_EVENT__" : body
  });
  if (rawBody) payload = payload.replace(PLACEHOLDER, () => rawBody);
  const res = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: payload
  });
  const data = await res.json().catch(() => ({}));
  if (data.verification_status !== "SUCCESS") {
    // PayPal's own answer, so the log says WHY: FAILURE with a 200 almost
    // always means PAYPAL_WEBHOOK_ID isn't the id of the webhook that sent
    // this; an error body (e.g. INVALID_RESOURCE_ID) means that id doesn't
    // exist in this PayPal environment at all.
    console.warn(`Webhook check: PayPal replied ${res.status} ${JSON.stringify(data).slice(0, 300)}; ` +
      `checked ${rawBody ? "the raw body" : "a re-serialised body (raw body unavailable)"}; ` +
      `PAYPAL_WEBHOOK_ID in use ends "${String(process.env.PAYPAL_WEBHOOK_ID || "(not set)").slice(-6)}", ` +
      `transmission ${headers["paypal-transmission-id"] || "(none)"}`);
  }
  return data.verification_status === "SUCCESS";
}

const PLAN_NAMES = { vip: "Super Supporter", noAds: "Supporter" };
// Every event type the handler below acts on (refund alerts: ALERT_LABELS).
const HANDLED_EVENTS = new Set([
  "BILLING.SUBSCRIPTION.ACTIVATED", "PAYMENT.SALE.COMPLETED", "PAYMENT.CAPTURE.COMPLETED",
  "BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED"
]);
// PayPal statuses for a subscription that is (or is about to be) billing.
const BILLING_STATUSES = ["APPROVAL_PENDING", "APPROVED", "ACTIVE", "SUSPENDED"];

async function getSubscription(subscriptionId) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  return res.json();
}

// True only if PayPal confirms it cancelled it just now (204). Already
// cancelled, or any error, is false — so two webhooks racing to cancel the
// same one only report it once.
async function cancelSubscriptionAtPayPal(subscriptionId, reason) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  return res.status === 204;
}

/* Points the user's profile at `subscriptionId` for this plan.

   One live subscription per plan per person. Someone can still end up with
   two (Subscribe tapped on two devices before the first one registered, or
   the page's guard bypassed). Every payment from either one has already
   counted — each stacks a month and pays its tokens — but only one should
   keep billing: the NEWER one, decided by PayPal's creation time rather
   than by which webhook happened to arrive first (a late renewal of the old
   one must not take over). The older one is cancelled at PayPal, since the
   Store can only show and cancel the one on record. */
async function recordSubscription(db, uid, planKey, subscriptionId, sub) {
  const field = planKey === "vip" ? "vipSubscriptionId" : "noAdsSubscriptionId";
  const userRef = db.collection("users").doc(uid);

  const onRecord = await db.runTransaction(async (tx) => {
    const [userSnap] = await tx.getAll(userRef);
    const current = userSnap.exists ? (userSnap.data()[field] || null) : null;
    if (!current || current === subscriptionId) {
      tx.set(userRef, { [field]: subscriptionId }, { merge: true });
      return null;
    }
    return current;
  });
  if (!onRecord) return;

  let other;
  try {
    other = await getSubscription(onRecord);
  } catch (e) {
    console.error(`Couldn't look up ${onRecord} while recording ${subscriptionId} for ${uid}:`, e.message);
    return;
  }
  // The one on record has already ended: nothing to choose between.
  if (!BILLING_STATUSES.includes(other.status)) {
    await db.runTransaction(async (tx) => {
      const [userSnap] = await tx.getAll(userRef);
      if (userSnap.exists && userSnap.data()[field] === onRecord) tx.set(userRef, { [field]: subscriptionId }, { merge: true });
    });
    return;
  }

  const thisIsNewer = (Date.parse(sub.create_time) || 0) >= (Date.parse(other.create_time) || 0);
  const keep = thisIsNewer ? subscriptionId : onRecord;
  const retire = thisIsNewer ? onRecord : subscriptionId;
  if (thisIsNewer) {
    await db.runTransaction(async (tx) => {
      const [userSnap] = await tx.getAll(userRef);
      if (userSnap.exists && userSnap.data()[field] === onRecord) tx.set(userRef, { [field]: keep }, { merge: true });
    });
  }

  const retireStatus = thisIsNewer ? other.status : sub.status;
  if (!BILLING_STATUSES.includes(retireStatus)) return;
  const cancelled = await cancelSubscriptionAtPayPal(retire, "Duplicate subscription to the same plan; the newer one stays active").catch(() => false);
  if (!cancelled) return;
  console.log(`Cancelled duplicate ${planKey} subscription ${retire} for ${uid}; keeping ${keep}.`);
  try {
    await userRef.collection("personalNotifications").add({
      type: "subscriptionDuplicate",
      title: "🔁 Duplicate subscription cancelled",
      body: `You had two ${PLAN_NAMES[planKey]} subscriptions, so we cancelled the older one — from now on you're only billed once a month. Nothing was lost: every payment already counted towards your plan time and tokens.`,
      createdAt: Date.now(),
      read: false
    });
  } catch (e) {
    console.warn(`Couldn't send duplicate-subscription notice to ${uid}:`, e.message);
  }
}

/* ---------------- Refunds, chargebacks, disputes ----------------
   Tokens and plan time are NOT taken back automatically: whether to, and
   how much (they may have spent some already), is the admin's call. This
   records an alert saying who, for what, and how many tokens that payment
   gave them, and drops a message in the admin's inbox. The admin page lists
   open alerts with one-tap tools to deal with them. */
const ALERT_LABELS = {
  "PAYMENT.CAPTURE.REFUNDED": "Refund",
  "PAYMENT.SALE.REFUNDED": "Refund",
  "PAYMENT.CAPTURE.REVERSED": "Chargeback / reversal",
  "PAYMENT.SALE.REVERSED": "Chargeback / reversal",
  "CUSTOMER.DISPUTE.CREATED": "Dispute opened"
};

// PayPal shapes these differently per event, so gather every id that could
// be the original payment and see which one we recorded when it was paid.
function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function candidatePaymentIds(resource) {
  const ids = [resource.id, resource.sale_id, resource.capture_id];
  for (const link of resource.links || []) {
    if (link.rel === "up" && typeof link.href === "string") ids.push(link.href.split("/").pop());
  }
  for (const t of resource.disputed_transactions || []) ids.push(t.seller_transaction_id, t.buyer_transaction_id);
  return [...new Set(ids.filter(id => typeof id === "string" && id && !id.includes("/")))];
}

function alertAmount(resource) {
  const a = resource.amount || resource.dispute_amount || {};
  const value = a.value || a.total;
  const currency = a.currency_code || a.currency || "";
  return value ? `${currency} ${value}`.trim() : "";
}

async function recordPaymentAlert(db, eventType, resource, { unverified = false } = {}) {
  let match = null;
  for (const id of candidatePaymentIds(resource)) {
    const [cap, sale] = await Promise.all([
      db.collection("processedPaypalCaptures").doc(id).get(),
      db.collection("processedPaypalSales").doc(id).get()
    ]);
    if (cap.exists) {
      const d = cap.data();
      const pack = getPack(d.packId);
      match = { uid: d.uid, paymentId: id, tokensGranted: d.tokensGranted || 0,
        what: pack ? `${pack.tokens}-token pack` : "token pack" };
      break;
    }
    if (sale.exists) {
      const d = sale.data();
      match = { uid: d.uid, paymentId: id, tokensGranted: d.tokensGranted || 0,
        what: `${PLAN_NAMES[d.planKey] || "subscription"} monthly payment` };
      break;
    }
  }
  // An unconfirmed alert must point at a payment we recorded ourselves;
  // its custom_id is the sender's word, so it isn't enough on its own.
  if (unverified && !match) return false;
  if (!match) {
    const tag = parsePackCustomId(resource.custom_id);
    if (tag) match = { uid: tag.uid, paymentId: null, tokensGranted: getPack(tag.packId).tokens, what: `${getPack(tag.packId).tokens}-token pack` };
  }

  let userName = "";
  let balance = null;
  if (match && match.uid) {
    const [u, w] = await Promise.all([
      db.collection("users").doc(match.uid).get(),
      db.collection("tokenWallets").doc(match.uid).get()
    ]);
    userName = u.exists ? (u.data().name || "") : "";
    balance = w.exists ? (w.data().balance || 0) : 0;
  }

  const label = ALERT_LABELS[eventType] || eventType;
  const alertId = `${eventType}_${resource.id || Date.now()}`.replace(/[^A-Za-z0-9._-]/g, "_");
  const alertRef = db.collection("adminAlerts").doc(alertId);
  const now = Date.now();
  const created = await db.runTransaction(async (tx) => {
    const [existing] = await tx.getAll(alertRef);
    if (existing.exists) return false; // PayPal re-sent the same event
    tx.set(alertRef, {
      eventType, label,
      uid: match ? match.uid : null,
      userName,
      what: match ? match.what : "a payment this site couldn't match to an account",
      tokensGranted: match ? match.tokensGranted : 0,
      balanceAtAlert: balance,
      amount: alertAmount(resource),
      paymentId: match ? match.paymentId : null,
      paypalIds: candidatePaymentIds(resource),
      signatureVerified: !unverified,
      createdAt: now,
      resolved: false
    });
    return true;
  });
  if (!created) return true;

  // The inbox renders titles and message bodies as HTML, and the name is
  // whatever the player chose — escaped so a name can't inject markup into
  // the admin's own inbox.
  const safeName = escapeHtml(userName);
  const who = match ? `${safeName || "Unknown name"} (uid ${escapeHtml(match.uid)})` : "an unknown account";
  const tokensLine = match && match.tokensGranted
    ? ` That payment gave them ${match.tokensGranted} tokens; they have ${balance} now.`
    : "";
  try {
    await db.collection("users").doc(ADMIN_UID).collection("personalNotifications").add({
      type: "adminAlert",
      title: `⚠️ ${label}: ${safeName || "check Admin → Tokens"}`,
      body: `${label} on ${match ? match.what : "a payment"}${alertAmount(resource) ? ` (${alertAmount(resource)})` : ""} by ${who}.${tokensLine}` +
        (unverified ? " PayPal's signature check didn't pass for this notice, so confirm it in your PayPal activity first." : "") +
        " Open Admin → Tokens to decide what to do.",
      createdAt: now,
      read: false
    });
  } catch (e) {
    console.warn("Couldn't send the admin alert notification:", e.message);
  }
  return true;
}

// The request body exactly as PayPal sent it, or null if the platform has
// already consumed it. Read with a short time limit so a stream that never
// ends can't hang the function.
async function readRawBody(req) {
  if (typeof req.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString("utf8");
  if (!req || typeof req[Symbol.asyncIterator] !== "function" || req.readableEnded) return null;
  const read = (async () => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
  try {
    const text = await Promise.race([read, timeout]);
    return text && text.trim().startsWith("{") ? text : null;
  } catch (e) {
    return null;
  }
}

/* Second way to trust a webhook, used only when the signature check fails
   (e.g. PAYPAL_WEBHOOK_ID doesn't match the webhook that sent it). For each
   event that moves money or plan time, look the thing up in PayPal by id,
   with this site's own credentials, and require PayPal to say it's in the
   state the event claims. A forged event can't pass: PayPal won't return a
   completed sale or capture that doesn't exist on this merchant account.
   PayPal's copy is returned and used instead of the event's own body, so
   nothing from an unverified body is trusted. Replaying a real event is
   harmless: every credit is keyed by its PayPal id and pays once.
   Refund/dispute alerts aren't covered here; they need the signature. */
async function confirmWithPayPal(eventType, resource) {
  const id = resource && resource.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{5,64}$/.test(id)) return null;
  let path, inState;
  if (eventType === "PAYMENT.SALE.COMPLETED") {
    path = `/v1/payments/sale/${id}`;
    inState = (r) => r.state === "completed" && typeof r.billing_agreement_id === "string";
  } else if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {
    path = `/v1/billing/subscriptions/${id}`;
    inState = (r) => r.status === "ACTIVE";
  } else if (["BILLING.SUBSCRIPTION.CANCELLED", "BILLING.SUBSCRIPTION.EXPIRED", "BILLING.SUBSCRIPTION.SUSPENDED"].includes(eventType)) {
    path = `/v1/billing/subscriptions/${id}`;
    inState = (r) => r.status === eventType.split(".").pop();
  } else if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    path = `/v2/payments/captures/${id}`;
    inState = (r) => r.status === "COMPLETED";
  } else {
    return null;
  }
  const { status, data } = await paypalJson(path);
  return status < 300 && data && data.id === id && inState(data) ? data : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  // Prefer the untouched text PayPal sent (see verifyWebhookSignature), and
  // parse the event from that same text so both always agree.
  const rawBody = await readRawBody(req);
  let event = null;
  if (rawBody) {
    try { event = JSON.parse(rawBody); } catch (e) { event = null; }
  }
  if (!event) event = req.body;
  if (typeof event === "string") {
    try { event = JSON.parse(event); } catch (e) { event = null; }
  }

  // The webhook may be subscribed to many event types this site doesn't use.
  // Acknowledge those straight away — nothing is done with them, so there's
  // nothing to verify — instead of rejecting them and having PayPal retry
  // each one for days.
  const type = (event || {}).event_type;
  if (!HANDLED_EVENTS.has(type) && !ALERT_LABELS[type]) {
    res.status(200).send("OK (event type not used here)");
    return;
  }

  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, event, rawBody);
  } catch (e) {
    console.error("Webhook verification error:", e.message);
  }
  // If the signature check fails, the events that move money or plan time
  // are confirmed with PayPal directly instead, and only PayPal's own copy
  // is used from then on (see confirmWithPayPal).
  let confirmed = null;
  if (!verified) {
    try {
      confirmed = await confirmWithPayPal((event || {}).event_type, (event || {}).resource || {});
    } catch (e) {
      console.error("Webhook direct confirmation error:", e.message);
    }
    // Refund/chargeback/dispute alerts move no money, so if the signature
    // fails they're still recorded, but only when they point at a payment
    // this site really recorded (checked in recordPaymentAlert), and marked
    // unconfirmed so the admin checks PayPal before acting.
    if (!confirmed && !ALERT_LABELS[(event || {}).event_type]) {
      console.warn("Rejected webhook: signature verification failed.");
      res.status(400).send("Signature verification failed");
      return;
    }
    if (confirmed) {
      console.warn(`Signature check failed, but PayPal confirmed ${event.event_type} ${confirmed.id} directly, so it's being processed. ` +
        "Check PAYPAL_WEBHOOK_ID so the signature check passes too.");
    }
  }
  const unverifiedAlert = !verified && !confirmed;

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const eventType = event.event_type;
  const resource = confirmed || event.resource || {};

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
        // Money may already have moved, so this must not be dropped. Usually
        // it's PAYPAL_VIP_PLAN_ID / PAYPAL_NOADS_PLAN_ID not matching the
        // plan in the log line. A 503 makes PayPal retry (for ~3 days), so
        // once the setting is fixed and redeployed the payment goes through
        // by itself; answering 200 here used to make PayPal give up on it.
        console.error(`Could not resolve uid/planKey for subscription ${subscriptionId}: plan_id "${sub.plan_id || "(none)"}" ` +
          `(PAYPAL_VIP_PLAN_ID "${process.env.PAYPAL_VIP_PLAN_ID || "(not set)"}", PAYPAL_NOADS_PLAN_ID "${process.env.PAYPAL_NOADS_PLAN_ID || "(not set)"}"), ` +
          `custom_id ${uid ? "set" : "MISSING"}. PayPal will retry.`);
        res.status(503).send("Unresolved uid/plan; retry later");
        return;
      }

      const expiresAtField = planKey === "vip" ? "vipExpiresAt" : "noAdsExpiresAt";
      const subscriptionIdField = planKey === "vip" ? "vipSubscriptionId" : "noAdsSubscriptionId";
      const userRef = db.collection("users").doc(uid);

      // ACTIVATED and PAYMENT.SALE.COMPLETED both fire for the SAME initial
      // charge. Only PAYMENT.SALE.COMPLETED represents an actual payment we
      // should grant time for — ACTIVATED just means the subscription is
      // now live, so it only needs to record the subscription id.
      if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {
        await recordSubscription(db, uid, planKey, subscriptionId, sub);
        console.log(`Recorded ${planKey} subscription id for user ${uid} (activation, no expiry change).`);
        res.status(200).send("OK");
        return;
      }

      // Idempotency guard: PayPal retries webhooks that don't get a fast
      // 200 response, which could otherwise double-grant for the exact same
      // sale. resource.id here is the unique PAYMENT SALE id (distinct from
      // the subscription id), so it's a safe one-time key.
      //
      // The check, the month of access and the tokens all happen in ONE
      // transaction. Checking first and writing afterwards (as this used to)
      // lets two deliveries of the same sale that arrive together both pass
      // the check — tolerable for a few extra days of VIP, not for currency.
      const saleId = resource.id;
      const processedRef = db.collection("processedPaypalSales").doc(saleId);
      const walletRef = db.collection("tokenWallets").doc(uid);
      const tokensGranted = TOKENS_PER_PAYMENT[planKey] || 0;
      const now = Date.now();

      const outcome = await db.runTransaction(async (tx) => {
        const [processedSnap, userSnap] = await tx.getAll(processedRef, userRef);
        if (processedSnap.exists) return { duplicate: true };

        // If they still have time left on a previous (possibly cancelled)
        // subscription, stack the new month on top of that instead of
        // resetting to "1 month from right now" — so resubscribing before
        // the old period ends adds 30 days rather than shortening it.
        const currentExpiresAt = userSnap.exists ? (userSnap.data()[expiresAtField] || 0) : 0;
        const baseTime = currentExpiresAt > now ? currentExpiresAt : now;

        // Which subscription id the profile points at is settled separately
        // (recordSubscription below): this payment counts either way.
        tx.set(userRef, { [expiresAtField]: baseTime + ONE_MONTH_MS }, { merge: true });
        if (tokensGranted > 0) {
          tx.set(walletRef, {
            balance: FieldValue.increment(tokensGranted),
            lifetimePurchased: FieldValue.increment(tokensGranted),
            updatedAt: now
          }, { merge: true });
        }
        tx.set(processedRef, { uid, planKey, tokensGranted, processedAt: now });
        return { duplicate: false, expiresAt: baseTime + ONE_MONTH_MS };
      });

      if (outcome.duplicate) {
        console.log(`Sale ${saleId} already processed, skipping duplicate.`);
        res.status(200).send("OK (duplicate sale, ignored)");
        return;
      }
      console.log(`Updated ${planKey} for user ${uid}, now expires ${new Date(outcome.expiresAt).toISOString()}, +${tokensGranted} tokens.`);
      await recordSubscription(db, uid, planKey, subscriptionId, sub);

      // Tell them, so a renewal visibly delivers something. Best-effort and
      // outside the transaction: the payment is already fully credited above,
      // and a failed notification must not make PayPal retry the sale.
      if (tokensGranted > 0) {
        try {
          await db.collection("users").doc(uid).collection("personalNotifications").add({
            type: "tokensGranted",
            title: `🪙 +${tokensGranted} tokens added`,
            body: `Your ${planKey === "vip" ? "Super Supporter" : "Supporter"} payment went through, and ${tokensGranted} tokens are in your wallet. To use them, enter a Secret Giveaway (Promo → Secret Giveaways) and add them to your entry — each token is one extra chance to win.`,
            createdAt: now,
            read: false
          });
        } catch (e) {
          console.warn(`Couldn't send token notification to ${uid}:`, e.message);
        }
      }
    }

    else if (ALERT_LABELS[eventType]) {
      const recorded = await recordPaymentAlert(db, eventType, resource, { unverified: unverifiedAlert });
      if (!recorded && unverifiedAlert) {
        console.warn("Rejected webhook: signature verification failed (alert for a payment this site never recorded).");
        res.status(400).send("Signature verification failed");
        return;
      }
    }

    else if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
      // One-off token packs (api/token-packs.js). The checkout call usually
      // credits these itself a second after paying; this is the backup for
      // when that call never finished, and the only path for a payment
      // PayPal held as PENDING and cleared later. creditTokenPack pays once
      // per capture whichever path gets there first.
      const orderId = ((resource.supplementary_data || {}).related_ids || {}).order_id || null;
      let tag = parsePackCustomId(resource.custom_id);
      if (!tag && !resource.custom_id && orderId) {
        // custom_id should be on the capture, but read the order if not.
        const { status, data } = await paypalJson(`/v2/checkout/orders/${orderId}`);
        if (status < 300) tag = parsePackCustomId(((data.purchase_units || [])[0] || {}).custom_id);
      }
      if (!tag || resource.status !== "COMPLETED") {
        res.status(200).send("OK (not a completed token pack, ignored)");
        return;
      }
      const result = await creditTokenPack(db, {
        captureId: resource.id, uid: tag.uid, packId: tag.packId, orderId, amount: resource.amount, source: "webhook"
      });
      if (result.reason) {
        console.error(`Capture ${resource.id} for ${tag.uid} not credited: ${result.reason}`, JSON.stringify(resource.amount));
      } else if (result.credited) {
        console.log(`Credited ${result.tokens} pack tokens to ${tag.uid} from capture ${resource.id} (webhook).`);
        await notifyPackCredited(db, tag.uid, result.tokens);
      }
    }

    else if (
      eventType === "BILLING.SUBSCRIPTION.CANCELLED" ||
      eventType === "BILLING.SUBSCRIPTION.EXPIRED" ||
      eventType === "BILLING.SUBSCRIPTION.SUSPENDED"
    ) {
      const subscriptionId = resource.id;

      // Same reasoning as the ACTIVATED branch above: resource.custom_id
      // and resource.plan_id are NOT reliably present on the webhook
      // payload for these event types. When custom_id is missing, uid was
      // silently undefined and this whole block was a no-op — Firestore's
      // subscriptionId never got cleared even though PayPal had already
      // emailed the user confirming cancellation. Fetching the subscription
      // directly from PayPal by id guarantees we get both fields.
      let uid = resource.custom_id;
      let planKey = planKeyFromPlanId(resource.plan_id);

      if ((!uid || !planKey) && subscriptionId) {
        try {
          const token = await getPayPalAccessToken();
          const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
            headers: { "Authorization": `Bearer ${token}` }
          });
          const sub = await subRes.json();
          uid = uid || sub.custom_id;
          planKey = planKey || planKeyFromPlanId(sub.plan_id);
        } catch (e) {
          console.error(`Couldn't fetch subscription ${subscriptionId} to resolve uid/plan:`, e.message);
        }
      }

      if (uid && planKey) {
        // We intentionally do NOT zero out expiresAt here — the user keeps
        // access until their already-paid-for period naturally ends
        // (isVipActive/isNoAdsActive already check expiresAt vs now).
        // We just clear the subscriptionId so the Store page knows to show
        // "Subscribe" again instead of "Cancel subscription" once expired.
        //
        // Only if it's still the subscription on record, though: when someone
        // cancels and resubscribes, the old one's notice can arrive after the
        // new one is recorded, and clearing then would orphan the new one —
        // the Store would offer Subscribe again and lose its Cancel button.
        const subscriptionIdField = planKey === "vip" ? "vipSubscriptionId" : "noAdsSubscriptionId";
        const userRef = db.collection("users").doc(uid);
        const cleared = await db.runTransaction(async (tx) => {
          const [userSnap] = await tx.getAll(userRef);
          if (!userSnap.exists || userSnap.data()[subscriptionIdField] !== subscriptionId) return false;
          tx.set(userRef, { [subscriptionIdField]: null }, { merge: true });
          return true;
        });
        console.log(cleared
          ? `Cleared ${subscriptionIdField} for user ${uid} (${eventType}).`
          : `${eventType} for ${subscriptionId}, which isn't ${uid}'s current ${planKey} subscription — left as is.`);
      } else {
        console.warn(`Could not resolve uid/planKey for subscription ${subscriptionId} on ${eventType} — subscriptionId was not cleared.`);
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
