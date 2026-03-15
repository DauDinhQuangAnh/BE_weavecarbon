# VNPAY Standard Setup

## Scope

This flow is implemented for the `Standard` plan only.

- FE redirects the user to VNPAY PAY.
- BE forces `VNPAYQR` when creating the payment URL.
- BE treats `IPN` as the source of truth.
- FE returns to `/overview` and polls `GET /api/subscription/payment-status`.
- `QueryDR` is used when the user comes back before `IPN` finishes.

## Backend env

Set these variables on the backend server:

```env
VNPAY_MODE=sandbox
VNPAY_TMN_CODE=your_tmn_code
VNPAY_HASH_SECRET=your_hash_secret
VNPAY_PAY_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_QUERYDR_URL=https://sandbox.vnpayment.vn/merchant_webapi/api/transaction
VNPAY_RETURN_URL=https://api.your-domain.com/api/subscription/vnpay/return
VNPAY_IPN_URL=https://api.your-domain.com/api/subscription/vnpay/ipn

FRONTEND_URL=https://app.your-domain.com
FRONTEND_URLS=https://app.your-domain.com,https://www.app.your-domain.com
AUTH_PUBLIC_BASE_URL=https://api.your-domain.com
```

Important:

- `VNPAY_RETURN_URL` should point to the backend route, not directly to FE.
- `VNPAY_IPN_URL` must be public HTTPS.
- `FRONTEND_URL` is used by BE to redirect the browser back to `/overview`.

## Frontend env

Set the FE to call the public backend:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.your-domain.com
```

The implemented FE flow already handles:

- `POST /api/subscription/upgrade`
- redirect to VNPAY
- return to `/overview`
- polling `GET /api/subscription/payment-status?session_id=...`

## What to configure on VNPAY

Register these values with VNPAY:

- `TMN_CODE`
- `HASH_SECRET`
- Return URL: `https://api.your-domain.com/api/subscription/vnpay/return`
- IPN URL: `https://api.your-domain.com/api/subscription/vnpay/ipn`

For local sandbox testing:

- localhost is not enough for `IPN`
- expose the backend with a public HTTPS tunnel or deploy a sandbox server
- set `FRONTEND_URL` and `AUTH_PUBLIC_BASE_URL` to those public URLs

## Sandbox checklist

1. Deploy BE to a public HTTPS URL.
2. Deploy FE or expose it on a public URL.
3. Set BE env to sandbox credentials and sandbox URLs.
4. Set FE `NEXT_PUBLIC_API_BASE_URL` to the BE public URL.
5. Create a `Standard` checkout from the pricing modal.
6. Confirm the VNPAY URL contains `vnp_BankCode=VNPAYQR`.
7. Complete payment and verify:
   - VNPAY calls `IPN`
   - BE marks the session paid
   - FE comes back to `/overview`
   - FE refreshes subscription state

## Production checklist

1. Replace sandbox credentials with production credentials from VNPAY.
2. Replace `VNPAY_PAY_URL` and `VNPAY_QUERYDR_URL` with production endpoints from VNPAY.
3. Replace `VNPAY_RETURN_URL` and `VNPAY_IPN_URL` with production HTTPS URLs.
4. Confirm the production domain is allowed in your VNPAY merchant configuration.
5. Confirm TLS, reverse proxy, and firewall allow inbound requests from VNPAY to the IPN route.
6. Run one real low-value transaction and verify:
   - `IPN` arrives
   - duplicate `IPN` does not double-upgrade
   - the user returns to FE with the correct payment result

## Runtime routes

- `POST /api/subscription/upgrade`
- `GET /api/subscription/payment-status?session_id=...`
- `GET /api/subscription/vnpay/return`
- `GET /api/subscription/vnpay/ipn`

## Notes

- FE no longer renders a local QR popup for VNPAY.
- If the user returns before `IPN`, FE will stay in pending state and poll the BE.
- If `IPN` is delayed, the BE attempts `QueryDR` during status polling.
