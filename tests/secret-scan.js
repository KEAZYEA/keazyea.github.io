/* Fails if a password, private key or secret API key has been put into the repo.
   Everything committed here is public (the site is served straight from it),
   so secrets belong in Vercel's Environment Variables, never in a file.
   Allowed on purpose: the Firebase web config's apiKey in appState.js — Firebase
   web keys are public by design (the Firestore/Storage rules protect the data).
   Run:  node tests/secret-scan.js */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SKIP = /\.(png|jpe?g|webp|gif|ico|svg|mp4|webm|mp3|woff2?|ttf|pdf|zip)$/i;
const RULES = [
    { name: "private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/ },
    { name: "Google service-account key file", re: /"private_key"\s*:\s*"-----BEGIN/ },
    { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/, allow: (line) => /^\s*apiKey\s*:/.test(line) }, // Firebase web config only
    { name: "GitHub token", re: /\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})/ },
    { name: "Stripe secret key", re: /\b[sr]k_live_[0-9A-Za-z]{16,}/ },
    { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
    { name: "OpenAI / Anthropic key", re: /\b(?:sk-ant-[0-9A-Za-z_-]{20,}|sk-(?:proj-)?[0-9A-Za-z]{32,})/ },
    // a secret written straight into the code instead of read from process.env
    { name: "hard-coded secret", re: /\b(?:PAYPAL_SECRET|PAYPAL_CLIENT_SECRET|FIREBASE_PRIVATE_KEY|CRON_SECRET|GOOGLE_TRANSLATE_KEY|PAYPAL_WEBHOOK_ID)\s*[:=]\s*["'`][^"'`\s]{8,}["'`]/ }
];
const SECRET_FILE = /(^|\/)(\.env(\.[\w.-]+)?|[^/]*service[-_]?account[^/]*\.json|[^/]*credentials[^/]*\.json|id_rsa|[^/]*\.pem|[^/]*\.p12|[^/]*\.key)$/i;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter(f => f && fs.existsSync(path.join(ROOT, f)));
const found = [];
let scanned = 0;
for (const f of files) {
    if (SECRET_FILE.test(f) && !/\.example$/i.test(f)) found.push(`${f}: a secrets file shouldn't be in the repo`);
    if (SKIP.test(f) || f.startsWith("tests/secret-scan")) continue;
    const full = path.join(ROOT, f);
    if (fs.statSync(full).size > 5 * 1024 * 1024) continue;
    const text = fs.readFileSync(full, "utf8");
    scanned++;
    text.split("\n").forEach((line, i) => {
        for (const r of RULES) {
            const m = line.match(r.re);
            // a made-up value in a test can say so with "secret-scan: fake" on its line
            if (m && !(r.allow && r.allow(line)) && !/secret-scan: fake/.test(line)) found.push(`${f}:${i + 1}: looks like a ${r.name} (${m[0].slice(0, 10)}…)`);
        }
    });
}
console.log(`Scanned ${scanned} files for secrets.`);
if (found.length) {
    console.error(`\n${found.length} possible secret${found.length > 1 ? "s" : ""} — move it into Vercel's Environment Variables, and change the key (it's public once pushed):`);
    found.forEach(x => console.error("  ✗ " + x));
    process.exit(1);
}
console.log("✓ No secrets found.");
