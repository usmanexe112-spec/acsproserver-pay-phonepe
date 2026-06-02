const https = require("https");
const http  = require("http");

// ── PhonePe PRODUCTION Credentials ─────────────────────────────────────────
const CLIENT_ID      = process.env.PHONEPE_CLIENT_ID      || "SU2605271219483440801383";
const CLIENT_SECRET  = process.env.PHONEPE_CLIENT_SECRET  || "00f6cf0e-d4a0-40b5-a5b6-45235fdee885";
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || "1";
const SITE_URL       = process.env.SITE_URL               || "https://affluentconsultancy.co.in";

// ── PhonePe PRODUCTION API Endpoints ───────────────────────────────────────
//    UAT would use: api-preprod.phonepe.com — we are NOT using that.
const PHONEPE_HOST  = "api.phonepe.com";
const TOKEN_PATH    = "/apis/identity-manager/v1/oauth/token";
const PAY_PATH      = "/apis/pg/checkout/v2/pay";

function statusPath(merchantOrderId) {
  return "/apis/pg/checkout/v2/order/" + encodeURIComponent(merchantOrderId) + "/status";
}

// ── Token Cache (reuse token for up to 55 min to avoid extra API calls) ─────
let _cachedToken  = null;
let _tokenExpires = 0;

// ── HTTPS helper (handles both POST and GET) ────────────────────────────────
function httpsRequest(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(body, "utf8") : null;
    const opts = {
      hostname,
      path,
      method,
      headers: Object.assign({}, headers),
      timeout: 20000
    };
    if (buf) opts.headers["Content-Length"] = buf.length;

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          reject(new Error("Bad JSON (HTTP " + res.statusCode + "): " + raw.substring(0, 400)));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out after 20s"));
    });
    req.on("error", reject);
    if (buf) req.write(buf);
    req.end();
  });
}

// ── Parse incoming request body ─────────────────────────────────────────────
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

// ── Get PhonePe access token (cached) ───────────────────────────────────────
async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpires) {
    return _cachedToken;
  }

  const body = [
    "client_id="      + encodeURIComponent(CLIENT_ID),
    "client_version=" + encodeURIComponent(CLIENT_VERSION),
    "client_secret="  + encodeURIComponent(CLIENT_SECRET),
    "grant_type=client_credentials"
  ].join("&");

  const result = await httpsRequest(
    PHONEPE_HOST,
    TOKEN_PATH,
    "POST",
    { "Content-Type": "application/x-www-form-urlencoded" },
    body
  );

  console.log("[Token] HTTP " + result.statusCode + ":", JSON.stringify(result.data));

  if (!result.data.access_token) {
    throw new Error("PhonePe auth failed — no access_token. Response: " + JSON.stringify(result.data));
  }

  _cachedToken  = result.data.access_token;
  // Cache for (expires_in - 5min), defaulting to 55 minutes
  const ttl     = ((result.data.expires_in || 3600) - 300) * 1000;
  _tokenExpires = Date.now() + ttl;

  return _cachedToken;
}

// ── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {

  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: "Affluent Consultancy Payment Server is running!",
      environment: "production",
      host: PHONEPE_HOST
    }));
    return;
  }

  // ── POST /payment — Create a new payment order ────────────────────────────
  if (req.method === "POST" && req.url === "/payment") {
    try {
      const body   = await parseBody(req);
      const amount = parseFloat(body.amount);
      const name   = String(body.name  || "Customer").trim();
      const phone  = String(body.phone || "9999999999").trim();
      const email  = String(body.email || "no-reply@affluentconsultancy.co.in").trim();

      if (!amount || amount < 1) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: "Enter a valid amount (minimum ₹1)." }));
        return;
      }

      // STEP 1: Get OAuth token
      let token;
      try {
        token = await getToken();
      } catch (e) {
        console.error("[Payment] Token error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Could not authenticate with PhonePe. Please try again." }));
        return;
      }

      // STEP 2: Create payment order
      const orderId     = "ACS" + Date.now() + Math.random().toString(36).substr(2, 4).toUpperCase();
      const redirectUrl = SITE_URL + "/payments/status/?orderId=" + orderId;
      const amountPaise = Math.round(amount * 100);

      const payload = JSON.stringify({
        merchantOrderId: orderId,
        amount:          amountPaise,
        expireAfter:     1200,
        metaInfo: {
          udf1: name,
          udf2: phone,
          udf3: email,
          udf4: "",
          udf5: ""
        },
        paymentFlow: {
          type:    "PG_CHECKOUT",
          message: "Payment for Affluent Consultancy Services",
          merchantUrls: { redirectUrl }
        }
      });

      let orderResult;
      try {
        orderResult = await httpsRequest(
          PHONEPE_HOST,
          PAY_PATH,
          "POST",
          {
            "Content-Type":  "application/json",
            "Authorization": "O-Bearer " + token
          },
          payload
        );
      } catch (e) {
        console.error("[Payment] Order creation error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Could not create payment order. Please try again." }));
        return;
      }

      console.log("[Payment] Order HTTP " + orderResult.statusCode + " for " + orderId + ":", JSON.stringify(orderResult.data));

      if (orderResult.data && orderResult.data.redirectUrl) {
        res.writeHead(200);
        res.end(JSON.stringify({
          success:     true,
          redirectUrl: orderResult.data.redirectUrl,
          orderId
        }));
        return;
      }

      // Token may have expired mid-request — clear cache and surface the error
      _cachedToken  = null;
      _tokenExpires = 0;

      res.writeHead(502);
      res.end(JSON.stringify({
        success: false,
        error:   "PhonePe did not return a checkout URL. Please try again.",
        detail:  orderResult.data
      }));

    } catch (err) {
      console.error("[Payment] Unhandled error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: "Server error: " + err.message }));
    }
    return;
  }

  // ── GET /status/:orderId — Verify payment status with PhonePe ────────────
  const statusMatch = req.method === "GET" && req.url.match(/^\/status\/([A-Za-z0-9]+)(\?.*)?$/);
  if (statusMatch) {
    const merchantOrderId = statusMatch[1];

    try {
      let token;
      try {
        token = await getToken();
      } catch (e) {
        console.error("[Status] Token error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Auth failed — could not check status." }));
        return;
      }

      let statusResult;
      try {
        statusResult = await httpsRequest(
          PHONEPE_HOST,
          statusPath(merchantOrderId),
          "GET",
          { "Authorization": "O-Bearer " + token },
          null
        );
      } catch (e) {
        console.error("[Status] Status check error:", e.message);
        res.writeHead(502);
        res.end(JSON.stringify({ success: false, error: "Could not reach PhonePe to check status." }));
        return;
      }

      console.log("[Status] HTTP " + statusResult.statusCode + " for " + merchantOrderId + ":", JSON.stringify(statusResult.data));

      const d     = statusResult.data || {};
      // PhonePe v2 returns: state = COMPLETED | FAILED | PENDING | STARTED
      const state = (d.state || d.transactionState || "").toUpperCase();

      res.writeHead(200);
      res.end(JSON.stringify({
        success:       true,
        orderId:       merchantOrderId,
        state,
        amount:        d.amount,          // in paise
        transactionId: d.transactionId || null,
        raw:           d
      }));

    } catch (err) {
      console.error("[Status] Unhandled error:", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: "Status check error: " + err.message }));
    }
    return;
  }

  // 404 for everything else
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("✅ Affluent Payment Server (PRODUCTION) running on port " + PORT);
  console.log("   PhonePe host: " + PHONEPE_HOST);
});

