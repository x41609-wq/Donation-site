require("dotenv").config();
const express = require("express");
const path = require("path");

const {
  PAYPAL_ENV = "sandbox", PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
  CURRENCY = "USD", PORT = 3000
} = process.env;
const BASE = PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

let plans = {};
try { plans = JSON.parse(process.env.MONTHLY_PLANS || "{}"); } catch (e) { console.error("MONTHLY_PLANS is not valid JSON"); }

if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env");
  process.exit(1);
}

async function accessToken() {
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET).toString("base64");
  const r = await fetch(BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const d = await r.json();
  if (!r.ok) throw new Error("PayPal auth failed: " + JSON.stringify(d));
  return d.access_token;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  res.json({ clientId: PAYPAL_CLIENT_ID, currency: CURRENCY, plans });
});

app.post("/api/orders", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!isFinite(amount) || amount < 1 || amount > 10000) {
      return res.status(400).json({ error: "Amount must be between 1 and 10000." });
    }
    const value = (Math.round(amount * 100) / 100).toFixed(2);
    const token = await accessToken();
    const r = await fetch(BASE + "/v2/checkout/orders", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{ description: "Donation", amount: { currency_code: CURRENCY, value } }]
      })
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Could not create order." });
    res.json({ id: d.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/orders/:id/capture", async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^A-Za-z0-9]/g, "");
    const token = await accessToken();
    const r = await fetch(BASE + "/v2/checkout/orders/" + id + "/capture", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Payment could not be completed." });
    res.json({ status: d.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error." });
  }
});

app.listen(PORT, () => console.log("Running on http://localhost:" + PORT + " (" + PAYPAL_ENV + ")"));
