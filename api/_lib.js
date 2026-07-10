/**
 * api/_lib.js
 * Shared helpers used by both api/paypal-webhook.js and api/cancel-subscription.js.
 * Not itself an API route (the leading underscore keeps Vercel from treating it as one).
 */

const admin = require("firebase-admin");

/* ---------------- Firebase Admin (singleton) ---------------- */
console.log("admin keys:", admin && Object.keys(admin));
   console.log("admin.apps:", admin.apps);
function getFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Vercel env vars store literal "\n" as two characters — convert
        // them back into real newlines or the key won't parse.
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
      })
    });
  }
  return admin;
}

/* ---------------- PayPal ---------------- */

const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";
const PAYPAL_API = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("PayPal auth failed: " + JSON.stringify(data));
  return data.access_token;
}

// Maps a PayPal Plan ID (from the webhook payload) back to which of our
// two plans it is, so we know which Firestore fields to update.
function planKeyFromPlanId(planId) {
  if (planId === process.env.PAYPAL_VIP_PLAN_ID) return "vip";
  if (planId === process.env.PAYPAL_NOADS_PLAN_ID) return "noAds";
  return null;
}

module.exports = { getFirebaseAdmin, getPayPalAccessToken, PAYPAL_API, planKeyFromPlanId };
