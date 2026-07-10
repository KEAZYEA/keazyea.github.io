/**
 * paypal-catalog.js
 * ------------------------------------------------------------
 * Reusable tool for managing your PayPal catalog:
 *   - Create Products + subscription Plans (run any time you add a new plan)
 *   - List existing products/plans (so you can find IDs again later)
 *   - Deactivate an old plan (stop new signups without affecting existing subscribers)
 *   - Test a one-time payment Order (for sanity-checking; NOT required for
 *     real one-time payments — your PayPal Buttons frontend code creates
 *     those live, with no pre-created object needed)
 *
 * SETUP:
 *   Set these as environment variables before running (never hardcode them):
 *     PAYPAL_CLIENT_ID
 *     PAYPAL_SECRET
 *     PAYPAL_ENV        "live" or "sandbox" (defaults to "sandbox" if unset —
 *                        you must opt in to "live" on purpose)
 *
 *   On Mac/Linux/WSL, run inline like:
 *     PAYPAL_CLIENT_ID=xxx PAYPAL_SECRET=yyy PAYPAL_ENV=live node paypal-catalog.js create-plans
 *
 * USAGE:
 *   node paypal-catalog.js create-plans      -> creates every product/plan listed in PLAN_MANIFEST below
 *                                                 (skips any whose name already exists, so safe to re-run)
 *   node paypal-catalog.js list               -> lists all products and plans currently on your account
 *   node paypal-catalog.js deactivate <planId> -> stops new signups on a plan (existing subscribers unaffected)
 *   node paypal-catalog.js test-order <amount> -> creates + captures a $<amount> USD one-time test order
 * ------------------------------------------------------------
 */

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";
const PAYPAL_API = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET environment variables. See the header comment for usage.");
  process.exit(1);
}

console.log(`Using PayPal environment: ${PAYPAL_ENV.toUpperCase()} (${PAYPAL_API})`);
if (PAYPAL_ENV === "live") {
  console.log("⚠️  LIVE mode — this will create real, billable products/plans.\n");
}

/* ------------------------------------------------------------
   EDIT THIS LIST whenever you want to add a new subscription plan.
   Re-running create-plans will skip any product name that already
   exists, so it's safe to just add a new entry and re-run.
   ------------------------------------------------------------ */
const PLAN_MANIFEST = [
  {
    productName: "KIH No Ads",
    productDescription: "Removes ads site-wide on Keazyea's Intelligence Hub",
    planName: "No Ads Monthly",
    priceUsd: "1.00",
    intervalUnit: "MONTH",   // MONTH, WEEK, DAY, or YEAR
    intervalCount: 1
  },
  {
    productName: "KIH VIP Pass",
    productDescription: "VIP perks on Keazyea's Intelligence Hub",
    planName: "VIP Pass Monthly",
    priceUsd: "2.00",
    intervalUnit: "MONTH",
    intervalCount: 1
  }
  // Add more here, e.g.:
  // {
  //   productName: "KIH VIP Pass (Yearly)",
  //   productDescription: "VIP perks, billed yearly",
  //   planName: "VIP Pass Yearly",
  //   priceUsd: "20.00",
  //   intervalUnit: "YEAR",
  //   intervalCount: 1
  // },
];

/* ---------------- low-level API helpers ---------------- */

async function getAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Auth failed: " + JSON.stringify(data));
  return data.access_token;
}

async function listAllProducts(token) {
  const res = await fetch(`${PAYPAL_API}/v1/catalogs/products?page_size=100`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const data = await res.json();
  return data.products || [];
}

async function listPlansForProduct(token, productId) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans?product_id=${productId}&page_size=20`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const data = await res.json();
  return data.plans || [];
}

async function createProduct(token, name, description) {
  const res = await fetch(`${PAYPAL_API}/v1/catalogs/products`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, type: "SERVICE", category: "SOFTWARE" })
  });
  const data = await res.json();
  if (!data.id) throw new Error("Product creation failed: " + JSON.stringify(data));
  return data.id;
}

async function createPlan(token, productId, name, priceUsd, intervalUnit, intervalCount) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: productId,
      name,
      billing_cycles: [{
        frequency: { interval_unit: intervalUnit, interval_count: intervalCount },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0, // 0 = infinite, until cancelled
        pricing_scheme: { fixed_price: { value: priceUsd, currency_code: "USD" } }
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 2
      }
    })
  });
  const data = await res.json();
  if (!data.id) throw new Error("Plan creation failed: " + JSON.stringify(data));
  return data.id;
}

async function deactivatePlan(token, planId) {
  const res = await fetch(`${PAYPAL_API}/v1/billing/plans/${planId}/deactivate`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error("Deactivate failed: " + JSON.stringify(data));
  }
}

async function createAndCaptureTestOrder(token, amountUsd) {
  const createRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: amountUsd } }]
    })
  });
  const order = await createRes.json();
  if (!order.id) throw new Error("Order creation failed: " + JSON.stringify(order));

  console.log(`Order created: ${order.id}`);
  const approveLink = (order.links || []).find(l => l.rel === "approve");
  console.log("This test order needs a buyer to approve it in a browser before it can be captured.");
  console.log("Approve link:", approveLink ? approveLink.href : "(none — check sandbox buyer account setup)");
  console.log("\nThis mirrors what your PayPal Buttons frontend code does automatically for real");
  console.log("one-time payments — you do NOT need this script for that in production.");
}

/* ---------------- commands ---------------- */

async function cmdCreatePlans() {
  const token = await getAccessToken();
  const existingProducts = await listAllProducts(token);

  for (const entry of PLAN_MANIFEST) {
    let product = existingProducts.find(p => p.name === entry.productName);

    let productId;
    if (product) {
      console.log(`Product "${entry.productName}" already exists (${product.id}) — reusing it.`);
      productId = product.id;
    } else {
      productId = await createProduct(token, entry.productName, entry.productDescription);
      console.log(`Created product "${entry.productName}" -> ${productId}`);
    }

    const existingPlans = await listPlansForProduct(token, productId);
    const existingPlan = existingPlans.find(p => p.name === entry.planName);
    if (existingPlan) {
      console.log(`  Plan "${entry.planName}" already exists -> ${existingPlan.id} (skipped)`);
      continue;
    }

    const planId = await createPlan(
      token, productId, entry.planName, entry.priceUsd, entry.intervalUnit, entry.intervalCount
    );
    console.log(`  Created plan "${entry.planName}" -> ${planId}`);
  }

  console.log("\nDone. Copy any newly-created Plan IDs into store.html.");
}

async function cmdList() {
  const token = await getAccessToken();
  const products = await listAllProducts(token);
  for (const product of products) {
    console.log(`\nProduct: ${product.name}  (${product.id})`);
    const plans = await listPlansForProduct(token, product.id);
    for (const plan of plans) {
      console.log(`  Plan: ${plan.name}  (${plan.id})  status=${plan.status}`);
    }
  }
}

async function cmdDeactivate(planId) {
  if (!planId) throw new Error("Usage: node paypal-catalog.js deactivate <planId>");
  const token = await getAccessToken();
  await deactivatePlan(token, planId);
  console.log(`Plan ${planId} deactivated — existing subscribers keep working, no new signups can start on it.`);
}

async function cmdTestOrder(amount) {
  if (!amount) throw new Error("Usage: node paypal-catalog.js test-order <amountUsd>");
  const token = await getAccessToken();
  await createAndCaptureTestOrder(token, amount);
}

/* ---------------- entry point ---------------- */

(async () => {
  const [, , command, arg] = process.argv;
  try {
    switch (command) {
      case "create-plans": await cmdCreatePlans(); break;
      case "list": await cmdList(); break;
      case "deactivate": await cmdDeactivate(arg); break;
      case "test-order": await cmdTestOrder(arg); break;
      default:
        console.log("Usage:");
        console.log("  node paypal-catalog.js create-plans");
        console.log("  node paypal-catalog.js list");
        console.log("  node paypal-catalog.js deactivate <planId>");
        console.log("  node paypal-catalog.js test-order <amountUsd>");
    }
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
})();
