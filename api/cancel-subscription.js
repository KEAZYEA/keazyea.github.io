/**
 * api/cancel-subscription.js
 * Called from store.html when the user clicks "Cancel subscription".
 * Verifies the caller's Firebase ID token (so only the real owner of an
 * account can cancel it), looks up their stored PayPal subscription id,
 * and tells PayPal to cancel it. Firestore itself isn't touched here —
 * the PayPal webhook (BILLING.SUBSCRIPTION.CANCELLED) will fire shortly
 * after and clear the subscriptionId field for us.
 */

const { getFirebaseAdmin, getPayPalAccessToken, PAYPAL_API } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    res.status(401).send("Missing Authorization header");
    return;
  }

  const admin = getFirebaseAdmin();

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    res.status(401).send("Invalid or expired token");
    return;
  }
  const uid = decoded.uid;

  const { plan } = req.body || {};
  if (plan !== "vip" && plan !== "noAds") {
    res.status(400).send("Body must include plan: 'vip' or 'noAds'");
    return;
  }

  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    res.status(404).send("User profile not found");
    return;
  }

  const profile = userSnap.data();
  const subscriptionId = plan === "vip" ? profile.vipSubscriptionId : profile.noAdsSubscriptionId;

  if (!subscriptionId) {
    res.status(400).send("No active subscription found for this plan");
    return;
  }

  try {
    const token = await getPayPalAccessToken();
    const cancelRes = await fetch(
      `${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}/cancel`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ reason: "User requested cancellation from store page" })
      }
    );

    // PayPal returns 204 No Content on success.
    if (cancelRes.status !== 204) {
      const errData = await cancelRes.json().catch(() => ({}));
      console.error("PayPal cancel failed:", errData);
      res.status(502).send("PayPal cancellation failed");
      return;
    }

    res.status(200).send("Cancellation requested");
  } catch (e) {
    console.error("Cancel-subscription error:", e.message);
    res.status(500).send("Server error");
  }
};
