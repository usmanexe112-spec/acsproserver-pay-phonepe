const https = require("https");
const http  = require("http");

// ── PhonePe Production Credentials ─────────────────────────────────────────
const CLIENT_ID      = process.env.PHONEPE_CLIENT_ID      || "SU2605271219483440801383";
const CLIENT_SECRET  = process.env.PHONEPE_CLIENT_SECRET  || "00f6cf0e-d4a0-40b5-a5b6-45235fdee885";
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const SITE_URL       = process.env.SITE_URL               || "https://affluentconsultancy.co.in";

// ── Simple HTTPS POST ───────────────────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, "utf8");
    const req = https.request(
      { hostname, path, method: "POST", headers: { ...headers, "Content-Length": buf.length } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error("Bad JSON: " + raw.substring(0, 300))); }
        });
      }
    );
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

// ── Parse request body ──────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); }
      catch (e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

// ── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "Affluent Consultancy Payment Server is running!" }));
    return;
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Payment endpoint
  if (req.method === "POST" && req.url === "/payment") {

    try {
      const body   = await parseBody(req);
      const amount = parseFloat(body.amount);
      const name   = String(body.name  || "Customer").trim();
      const phone  = String(body.phone || "9999999999").trim();
      const email  = String(body.email || "").trim();

      if (!amount || amount < 1) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: "Enter a valid amount (minimum ₹1)." }));
        return;
      }

      // ── STEP 1: Get Token ─────────────────────────────────────────────────
      const tokenBody = [
        "client_id="      + encodeURIComponent(CLIENT_ID),
        "client_version=" + encodeURIComponent(CLIENT_VERSION),
        "client_secret="  + encodeURIComponent(CLIENT_SECRET),
        "grant_type=client_credentials"
      ].join("&");

      let tokenData;
      try {
        tokenData = await httpsPost(
          "api.phonepe.com",
          "/apis/identity-manager/v1/oauth/token",
          { "Content-Type": "application/x-www-form-urlencoded" },
          tokenBody
        );
      } catch (e) {
        console.error("Token error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Could not reach PhonePe. Try again." }));
        return;
      }

      console.log("Token response:", JSON.stringify(tokenData));

      if (!tokenData.access_token) {
        console.error("No access_token:", JSON.stringify(tokenData));
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "PhonePe auth failed.", detail: tokenData }));
        return;
      }

      // ── STEP 2: Create Payment ────────────────────────────────────────────
      const orderId     = "ACS" + Date.now() + Math.random().toString(36).substr(2, 4).toUpperCase();
      const redirectUrl = SITE_URL + "/payments/status/?orderId=" + orderId;
      const amountPaise = Math.round(amount * 100);

      const paymentPayload = JSON.stringify({
        merchantOrderId: orderId,
        amount: amountPaise,
        expireAfter: 1200,
        metaInfo: { udf1: name, udf2: phone, udf3: email, udf4: "", udf5: "" },
        paymentFlow: {
          type: "PG_CHECKOUT",
          message: "Payment for Affluent Consultancy Services",
          merchantUrls: { redirectUrl }
        }
      });

      let orderData;
      try {
        orderData = await httpsPost(
          "api.phonepe.com",
          "/apis/pg/checkout/v2/pay",
          {
            "Content-Type":  "application/json",
            "Authorization": "O-Bearer " + tokenData.access_token
          },
          paymentPayload
        );
      } catch (e) {
        console.error("Order error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Could not create payment. Try again." }));
        return;
      }

      console.log("Order response:", JSON.stringify(orderData));

      if (orderData.redirectUrl) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, redirectUrl: orderData.redirectUrl, orderId }));
        return;
      }

      res.writeHead(502);
      res.end(JSON.stringify({ success: false, error: "PhonePe did not return checkout URL.", detail: orderData }));

    } catch (err) {
      console.error("Unhandled:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: "Server error: " + err.message }));
    }

    return;
  }

  // 404 for anything else
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Payment server running on port " + PORT);
});
