/**
 * api/_lib.js
 * Shared helpers used by both api/paypal-webhook.js and api/cancel-subscription.js.
 * Not itself an API route (the leading underscore keeps Vercel from treating it as one).
 */
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

/* ---------------- Firebase Admin (singleton) ---------------- */
function getFirebaseAdmin() {
  if (!getApps().length) {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      throw new Error("Missing required Firebase Admin env vars (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).");
    }
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      })
    });
  }
  return {
    firestore: getFirestore,
    auth: getAuth
  };
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

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`PayPal auth failed: non-JSON response (status ${res.status})`);
  }

  if (!res.ok || !data.access_token) {
    throw new Error(`PayPal auth failed (status ${res.status}): ${JSON.stringify(data)}`);
  }
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
