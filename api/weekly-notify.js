/**
 * api/weekly-notify.js
 * Vercel Cron target. Posts the "new weekly giveaway is open" broadcast into
 * the shared `notifications` collection, which every client already listens
 * to for its inbox.
 *
 * Runs DAILY (see the crons entry in vercel.json) rather than only at Monday
 * 00:00, and no-ops unless the giveaway week has actually rolled over. Free
 * Vercel crons fire at approximate times, so a run that lands late — or is
 * skipped entirely — would otherwise lose a whole week's announcement. With
 * this shape, the first run that sees a new week posts it and every later run
 * that day is a no-op, so the schedule can drift without anyone noticing.
 *
 * Idempotency is enforced by the DOCUMENT ID (`weekly-<weekId>`) plus
 * .create(), which fails if the doc already exists. That's what makes a
 * duplicate run harmless even if two fire concurrently — unlike a
 * read-then-write check, which could race.
 */

const { getFirebaseAdmin } = require("./_lib");

// The browser computes getWeekId() from each visitor's OWN local clock, so
// clients in different timezones already disagree about the current week by
// up to a day. The server has to pick one, and it picks the admin's zone so
// the announcement lands at local midnight for whoever runs the site.
// Override with GIVEAWAY_TZ_OFFSET_HOURS if that ever changes.
const TZ_OFFSET_HOURS = parseFloat(process.env.GIVEAWAY_TZ_OFFSET_HOURS || "8");

/* Mirrors getNextSunday()/getWeekId() in appState.js. The id is the UPCOMING
   Sunday, which means it changes every Monday at 00:00 and stays put for the
   rest of the week — so "the id changed" is exactly "a new week started". */
function getWeekId() {
  const nowShifted = new Date(Date.now() + TZ_OFFSET_HOURS * 60 * 60 * 1000);
  const y = nowShifted.getUTCFullYear();
  const m = nowShifted.getUTCMonth();
  const d = nowShifted.getUTCDate();
  const daysUntilSunday = (7 - nowShifted.getUTCDay()) % 7;
  const sunday = new Date(Date.UTC(y, m, d + daysUntilSunday));
  const yyyy = sunday.getUTCFullYear();
  const mm = String(sunday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(sunday.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = async (req, res) => {
  // Vercel sends this header when CRON_SECRET is configured on the project.
  // Checked only when the variable is actually set, so the job still works
  // before you've configured one. Forging a call wouldn't achieve much
  // anyway — the worst case is posting the same announcement a day early.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const weekId = getWeekId();
    const docId = `weekly-${weekId}`;

    await db.collection("notifications").doc(docId).create({
      type: "weeklyGiveawayNew",
      title: "🎡 New Weekly Giveaway!",
      // Matches what the clients write: a plain epoch number, NOT a Firestore
      // Timestamp. The inbox renders this with new Date(n.createdAt), which
      // would show "Invalid Date" for a Timestamp object.
      createdAt: Date.now(),
      sourceId: weekId,
      body:
        "This week's giveaway is now open.\n\n" +
        "Open to 🍎 iOS and 🤖 Android players — everyone can enter.\n" +
        "Entries close Sunday, when the winner is drawn.\n\n" +
        "Tap below to spin and take part."
    });

    res.status(200).json({ ok: true, posted: true, weekId });
  } catch (e) {
    // create() on an existing doc — this week was already announced, which is
    // the expected outcome for every run after the first one each week.
    if (e && e.code === 6) {
      res.status(200).json({ ok: true, posted: false, reason: "already announced this week" });
      return;
    }
    console.error("weekly-notify failed:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
