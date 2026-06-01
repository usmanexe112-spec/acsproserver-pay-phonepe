# Affluent Consultancy - Payment Server

PhonePe payment backend. Deploy on Render.com (free).

## Deploy on Render

1. Push this folder to a GitHub repo (can be separate private repo)
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - Name: affluent-payment
   - Runtime: Node
   - Build Command: (leave blank)
   - Start Command: node server.js
5. Click Create Web Service
6. Copy your Render URL e.g. https://affluent-payment.onrender.com

## Test it
Visit: https://affluent-payment.onrender.com
Should show: {"status":"Affluent Consultancy Payment Server is running!"}

## Update payments page
In your website payments/index.html, the API URL is already set.
Just replace YOUR-RENDER-URL with your actual Render URL.
