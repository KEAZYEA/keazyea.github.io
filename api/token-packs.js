/**
 * api/token-packs.js
 * One-off token packs bought with PayPal checkout (separate from the monthly
 * subscriptions, which pay out tokens through paypal-webhook.js).
 *
 * POST JSON { action, ... } with the buyer's Firebase ID token:
 *   createOrder  { packId }  -> { orderID }, a PayPal order priced from TOKEN_PACKS
 *   captureOrder { orderID } -> takes the payment and credits the tokens:
 *                               { status: "credited" | "pending", tokens }
 *
 * The price and the token count both come from TOKEN_PACKS in _lib.js, never
 * from the page. Tokens are credited only once PayPal reports the capture
 * COMPLETED, and only once per capture (creditTokenPack). Two backups go
 * through the webhook's PAYMENT.CAPTURE.COMPLETED: a payment PayPal holds as
 * PENDING is credited there once it clears, and so is one where this call
 * died after PayPal took the money but before the credit.
 */

const {
  getFirebaseAdmin, paypalJson, PACK_CURRENCY, getPack, packPrice, packCustomId,
  parsePackCustomId, amountMatchesPack, creditTokenPack, notifyPackCredited, isBannedNow
} = require("./_lib");

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}

async function verifyCaller(admin, req) {
  const header = req.headers.authorization || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!idToken) throw new HttpError(401, "Sign in first.");
  try {
    return (await admin.auth().verifyIdToken(idToken)).uid;
  } catch (e) {
    throw new HttpError(401, "Your session expired — refresh the page and try again.");
  }
}

// Checked before any money moves: someone restricted can't use tokens, so
// they shouldn't be able to pay for them either.
async function assertNotBanned(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (snap.exists && isBannedNow(snap.data())) {
    throw new HttpError(403, "Your account is currently restricted.");
  }
}

function paypalIssue(data) {
  return ((data && data.details) || [])[0]?.issue || null;
}

async function getOrder(orderID) {
  const { status, data } = await paypalJson(`/v2/checkout/orders/${orderID}`);
  if (status === 404) throw new HttpError(404, "That PayPal order doesn't exist.");
  if (status >= 300) {
    console.error(`Couldn't read order ${orderID} (${status}):`, JSON.stringify(data));
    throw new HttpError(502, "Couldn't reach PayPal — try again in a moment.");
  }
  return data;
}

async function createOrder(db, uid, body) {
  const pack = getPack(body.packId);
  if (!pack) throw new HttpError(400, "Pick a token pack.");
  await assertNotBanned(db, uid);

  const value = packPrice(pack);
  const money = { currency_code: PACK_CURRENCY, value };
  const { status, data } = await paypalJson("/v2/checkout/orders", {
    method: "POST",
    body: {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: body.packId,
        custom_id: packCustomId(body.packId, uid),
        description: `${pack.tokens} tokens — Keazyea's Intelligence Hub`,
        amount: { ...money, breakdown: { item_total: money } },
        items: [{ name: `${pack.tokens} tokens`, quantity: "1", unit_amount: money, category: "DIGITAL_GOODS" }]
      }],
      // Nothing gets posted, so don't ask the buyer for an address.
      application_context: { shipping_preference: "NO_SHIPPING", brand_name: "Keazyea's Intelligence Hub" }
    }
  });
  if (status >= 300 || !data.id) {
    console.error(`createOrder failed (${status}):`, JSON.stringify(data));
    throw new HttpError(502, "PayPal couldn't start the checkout — try again in a moment.");
  }
  return { ok: true, orderID: data.id };
}

async function captureOrder(db, uid, body) {
  const { orderID } = body;
  if (typeof orderID !== "string" || !/^[A-Za-z0-9-]{5,64}$/.test(orderID)) {
    throw new HttpError(400, "Missing PayPal order.");
  }

  // Read the order before touching it: it has to be THIS user's pack order
  // at exactly the pack's price, whatever the page claims.
  let order = await getOrder(orderID);
  const unit = (order.purchase_units || [])[0] || {};
  const tag = parsePackCustomId(unit.custom_id);
  if (!tag || tag.uid !== uid) throw new HttpError(403, "That payment isn't linked to your account.");
  const pack = getPack(tag.packId);
  if (!amountMatchesPack(unit.amount, pack)) {
    console.error(`Order ${orderID} amount ${JSON.stringify(unit.amount)} doesn't match pack ${tag.packId}`);
    throw new HttpError(400, "That order's amount doesn't match the pack.");
  }

  if (order.status === "APPROVED") {
    await assertNotBanned(db, uid);
    // An order can only ever be captured once, so a repeat (double tap,
    // retry, another device) can't charge twice. No PayPal-Request-Id on
    // purpose: after a decline, checkout restarts and captures this SAME
    // order again, and a reused request id could replay the old decline.
    const { status, data } = await paypalJson(`/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { "Prefer": "return=representation" },
      body: {}
    });
    if (status === 422 && paypalIssue(data) === "INSTRUMENT_DECLINED") {
      // PayPal's documented recovery: reopen checkout to pick another way to pay.
      throw new HttpError(402, "PayPal declined that payment method — choose another one.", { restart: true });
    }
    if (status < 300) {
      order = data;
    } else {
      // Most often a simultaneous call got there first (ORDER_ALREADY_CAPTURED
      // or similar). Whatever the reason, the order itself says whether
      // money was taken.
      order = await getOrder(orderID);
      if (order.status !== "COMPLETED") {
        console.error(`Capture failed for ${orderID} (${status}):`, JSON.stringify(data));
        throw new HttpError(502, "PayPal couldn't complete the payment. If you were charged, your tokens will be added automatically within a few minutes.");
      }
    }
  } else if (order.status !== "COMPLETED") {
    throw new HttpError(400, "This payment wasn't approved in PayPal.");
  }

  const payments = (((order.purchase_units || [])[0] || {}).payments) || {};
  const capture = (payments.captures || [])[0];
  if (!capture) {
    console.error(`Order ${orderID} has no capture:`, JSON.stringify(order));
    throw new HttpError(502, "PayPal didn't confirm the payment. If you were charged, your tokens will be added automatically within a few minutes.");
  }
  if (capture.status === "PENDING") {
    // Held for review by PayPal. The webhook credits it once it clears.
    return { ok: true, status: "pending", tokens: pack.tokens };
  }
  if (capture.status !== "COMPLETED") {
    throw new HttpError(402, "PayPal didn't accept this payment, so nothing was charged.");
  }

  const result = await creditTokenPack(db, {
    captureId: capture.id, uid, packId: tag.packId, orderId: orderID, amount: capture.amount, source: "checkout"
  });
  if (result.reason) {
    console.error(`Capture ${capture.id} for ${uid} not credited: ${result.reason}`, JSON.stringify(capture.amount));
    throw new HttpError(500, "Your payment went through but the tokens couldn't be added — please contact us.");
  }
  if (result.credited) await notifyPackCredited(db, uid, pack.tokens);
  return { ok: true, status: "credited", tokens: pack.tokens };
}

module.exports = async (req, res) => {
  // The site is on GitHub Pages and this API on Vercel, so the browser sends
  // a CORS preflight first; without these headers it's blocked outright.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  const body = req.body || {};
  try {
    const admin = getFirebaseAdmin();
    const uid = await verifyCaller(admin, req);
    const db = admin.firestore();

    let result;
    switch (body.action) {
      case "createOrder": result = await createOrder(db, uid, body); break;
      case "captureOrder": result = await captureOrder(db, uid, body); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && !e.status) console.error("token-packs failed:", e);
    res.status(status).json({
      ok: false,
      ...(e.extra || {}),
      error: e.status ? e.message : "Something went wrong. If you were charged, your tokens will be added automatically within a few minutes."
    });
  }
};
