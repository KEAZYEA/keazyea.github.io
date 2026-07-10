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
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Vercel env vars store literal "\n" as two characters — convert
        // them back into real newlines or the key won't parse.
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
      })
    });
  }
  // Backward-compatible shim so existing code calling admin.firestore()
  // and admin.auth() keeps working without changes to other files.
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
