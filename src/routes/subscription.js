const express = require('express');
const router = express.Router();
const subscriptionService = require('../services/subscriptionService');
const validate = require('../middleware/validator');
const { authenticate, requireRole, requireCompanyAdmin } = require('../middleware/auth');
const { upgradeSubscriptionValidation } = require('../validators/subscriptionValidators');
const { resolveBackendBaseUrl, resolveFrontendBaseUrl } = require('../config/urls');

const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (Array.isArray(forwarded)) return forwarded[0];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || '127.0.0.1';
};

const getPreferredFrontendOrigin = (session, req) => {
    const metadata = session?.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    if (typeof metadata.frontend_origin === 'string' && metadata.frontend_origin.trim()) {
        return metadata.frontend_origin.trim();
    }

    if (typeof req.headers.origin === 'string' && req.headers.origin.trim()) {
        return req.headers.origin.trim();
    }

    if (typeof req.headers.referer === 'string' && req.headers.referer.trim()) {
        return req.headers.referer.trim();
    }

    return undefined;
};

const buildFrontendPaymentResultUrl = (params = {}, preferredOrigin) => {
    const frontendBaseUrl = resolveFrontendBaseUrl(preferredOrigin);
    const url = new URL('/overview', `${frontendBaseUrl}/`);

    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'undefined' || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
    }

    return url.toString();
};

// 1. GET /api/subscription - Get subscription info and usage
router.get('/', authenticate, requireRole('b2b'), async (req, res, next) => {
    try {
        if (!req.companyId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'NO_COMPANY',
                    message: 'User does not belong to a company'
                }
            });
        }

        const subscription = await subscriptionService.getSubscription(req.userId, req.companyId);

        res.json({
            success: true,
            data: subscription
        });
    } catch (error) {
        next(error);
    }
});

// 2. POST /api/subscription/upgrade - Upgrade subscription
router.post('/upgrade', authenticate, requireRole('b2b'), requireCompanyAdmin, upgradeSubscriptionValidation, validate, async (req, res, next) => {
    try {
        const { target_plan, billing_cycle, payment_provider, standard_sku_limit } = req.body;

        if (!req.companyId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'NO_COMPANY',
                    message: 'User does not belong to a company'
                }
            });
        }

        const paymentSession = await subscriptionService.upgradeSubscription(
            req.userId,
            req.companyId,
            target_plan,
            billing_cycle,
            payment_provider,
            {
                ipAddr: getClientIp(req),
                userAgent: req.headers['user-agent'],
                standardSkuLimit: standard_sku_limit,
                frontendOrigin: req.headers.origin || req.headers.referer || ''
            }
        );

        res.json({
            success: true,
            data: paymentSession,
            message: 'Payment session created'
        });
    } catch (error) {
        next(error);
    }
});

router.get('/payment-status', authenticate, requireRole('b2b'), requireCompanyAdmin, async (req, res, next) => {
    try {
        const sessionId = String(req.query.session_id || '').trim();
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_SESSION_ID',
                    message: 'session_id is required'
                }
            });
        }

        if (!req.companyId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'NO_COMPANY',
                    message: 'User does not belong to a company'
                }
            });
        }

        const paymentStatus = await subscriptionService.getPaymentStatus(sessionId, req.companyId, {
            ipAddr: getClientIp(req)
        });

        res.json({
            success: true,
            data: paymentStatus
        });
    } catch (error) {
        next(error);
    }
});

router.get('/vnpay/mock-checkout', async (req, res, next) => {
    try {
        const sessionId = String(req.query.session_id || '').trim();
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_SESSION_ID',
                    message: 'session_id is required'
                }
            });
        }

        const session = await subscriptionService.getPaymentSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'SESSION_NOT_FOUND',
                    message: 'Payment session not found'
                }
            });
        }

        const backendBaseUrl = resolveBackendBaseUrl();
        const successUrl = `${backendBaseUrl}/api/subscription/vnpay/mock-complete?session_id=${encodeURIComponent(sessionId)}&status=success`;
        const failedUrl = `${backendBaseUrl}/api/subscription/vnpay/mock-complete?session_id=${encodeURIComponent(sessionId)}&status=failed`;

        const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VNPay Mock Checkout</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: Arial, sans-serif; background: #f4f7fb; margin: 0; padding: 32px; }
    .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
    h1 { margin-top: 0; font-size: 22px; }
    .meta { color: #334155; line-height: 1.6; margin: 16px 0; }
    .row { display: flex; gap: 12px; margin-top: 16px; }
    a.btn { flex: 1; text-align: center; text-decoration: none; padding: 12px 16px; border-radius: 8px; font-weight: 600; }
    .ok { background: #16a34a; color: white; }
    .fail { background: #dc2626; color: white; }
  </style>
</head>
<body>
  <div class="card">
    <h1>VNPay Mock Checkout</h1>
    <div class="meta">
      <div><strong>Session:</strong> ${session.id}</div>
      <div><strong>Plan:</strong> ${session.target_plan}</div>
      <div><strong>Billing:</strong> ${session.billing_cycle}</div>
      <div><strong>Amount:</strong> ${session.amount} VND</div>
    </div>
    <div class="row">
      <a class="btn ok" href="${successUrl}">Thanh toan thanh cong</a>
      <a class="btn fail" href="${failedUrl}">Thanh toan that bai</a>
    </div>
  </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (error) {
        next(error);
    }
});

router.get('/vnpay/mock-complete', async (req, res, next) => {
    try {
        const sessionId = String(req.query.session_id || '').trim();
        const status = String(req.query.status || '').trim().toLowerCase();

        if (!sessionId) {
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl({
                    payment_status: 'failed',
                    source: 'vnpay',
                    reason: 'missing_session_id'
                })
            );
        }

        const session = await subscriptionService.getPaymentSession(sessionId);
        if (!session) {
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl({
                    payment_status: 'failed',
                    source: 'vnpay',
                    reason: 'session_not_found'
                })
            );
        }

        if (status === 'success') {
            const result = await subscriptionService.completeUpgrade(sessionId, '00', {
                source: 'mock'
            });
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl(
                    {
                        payment_status: result.updated || session.status === 'success' ? 'success' : 'expired',
                        source: 'vnpay',
                        session_id: sessionId,
                        plan: result.current_plan || session.target_plan || undefined
                    },
                    getPreferredFrontendOrigin(session, req)
                )
            );
        }

        await subscriptionService.completeUpgrade(sessionId, '24', {
            source: 'mock'
        });
        return res.redirect(
            302,
            buildFrontendPaymentResultUrl(
                {
                    payment_status: 'failed',
                    source: 'vnpay',
                    session_id: sessionId,
                    plan: session.target_plan || undefined
                },
                getPreferredFrontendOrigin(session, req)
            )
        );
    } catch (error) {
        next(error);
    }
});

router.get('/vnpay/return', async (req, res, next) => {
    try {
        const vnpayMode = subscriptionService.getVnpayMode();
        if (vnpayMode === 'mock') {
            const sessionId = String(req.query.session_id || '').trim();
            if (!sessionId) {
                return res.redirect(
                    302,
                    buildFrontendPaymentResultUrl({
                        payment_status: 'failed',
                        source: 'vnpay',
                        reason: 'missing_session_id'
                    })
                );
            }

            const session = await subscriptionService.getPaymentSession(sessionId);
            const publicStatus = session ? subscriptionService.toPublicPaymentStatus(session.status) : 'failed';
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl(
                    {
                        payment_status: publicStatus === 'paid' ? 'success' : publicStatus,
                        source: 'vnpay',
                        session_id: sessionId,
                        plan: session?.target_plan || undefined
                    },
                    getPreferredFrontendOrigin(session, req)
                )
            );
        }

        const verification = subscriptionService.verifyVnpayReturnQuery(req.query);
        const transactionRef = String(verification.transactionRef || '').trim();
        const responseCode = String(verification.responseCode || '').trim() || '99';
        const transactionStatus = String(verification.transactionStatus || '').trim();

        if (!transactionRef) {
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl({
                    payment_status: 'failed',
                    source: 'vnpay',
                    reason: 'missing_transaction_ref'
                })
            );
        }

        if (!verification.isValidSignature) {
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl({
                    payment_status: 'failed',
                    source: 'vnpay',
                    reason: 'invalid_signature',
                    transaction_ref: transactionRef
                })
            );
        }

        const session = await subscriptionService.getPaymentSessionByTransactionRef(transactionRef);
        if (!session) {
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl({
                    payment_status: 'failed',
                    source: 'vnpay',
                    reason: 'session_not_found',
                    transaction_ref: transactionRef
                })
            );
        }

        const expectedAmount = Math.round(Number(session.amount || 0) * 100);
        if (verification.amount && verification.amount !== expectedAmount) {
            return res.redirect(
                302,
                buildFrontendPaymentResultUrl(
                    {
                        payment_status: 'failed',
                        source: 'vnpay',
                        session_id: session.id,
                        transaction_ref: transactionRef,
                        reason: 'amount_mismatch'
                    },
                    getPreferredFrontendOrigin(session, req)
                )
            );
        }

        const existingStatus = subscriptionService.toPublicPaymentStatus(session.status);
        const paymentStatus = (() => {
            if (existingStatus === 'paid') return 'success';
            if (existingStatus === 'failed') return 'failed';
            if (existingStatus === 'expired') return 'expired';
            if (!subscriptionService.isSuccessfulVnpayResult(responseCode, transactionStatus)) {
                return 'failed';
            }
            return 'pending';
        })();

        return res.redirect(
            302,
            buildFrontendPaymentResultUrl(
                {
                    payment_status: paymentStatus,
                    source: 'vnpay',
                    session_id: session.id,
                    transaction_ref: transactionRef,
                    plan: session.target_plan || undefined
                },
                getPreferredFrontendOrigin(session, req)
            )
        );
    } catch (error) {
        next(error);
    }
});

router.get('/vnpay/ipn', async (req, res, next) => {
    try {
        if (subscriptionService.getVnpayMode() === 'mock') {
            return res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
        }

        const verification = subscriptionService.verifyVnpayReturnQuery(req.query);
        const transactionRef = String(verification.transactionRef || '').trim();
        const responseCode = String(verification.responseCode || '').trim() || '99';
        const transactionStatus = String(verification.transactionStatus || '').trim();

        if (!verification.isValidSignature) {
            return res.status(200).json({ RspCode: '97', Message: 'Invalid signature' });
        }

        if (!transactionRef) {
            return res.status(200).json({ RspCode: '01', Message: 'Order not found' });
        }

        const session = await subscriptionService.getPaymentSessionByTransactionRef(transactionRef);
        if (!session) {
            return res.status(200).json({ RspCode: '01', Message: 'Order not found' });
        }

        const expectedAmount = Math.round(Number(session.amount || 0) * 100);
        if (verification.amount && verification.amount !== expectedAmount) {
            return res.status(200).json({ RspCode: '04', Message: 'Invalid amount' });
        }

        const existingStatus = subscriptionService.toPublicPaymentStatus(session.status);
        if (existingStatus === 'paid') {
            return res.status(200).json({ RspCode: '02', Message: 'Order already confirmed' });
        }

        if (existingStatus === 'expired') {
            return res.status(200).json({ RspCode: '02', Message: 'Order already expired' });
        }

        await subscriptionService.completeUpgrade(session.id, responseCode, {
            source: 'ipn',
            transactionStatus,
            gatewayDetails: {
                amount: verification.amount,
                transactionNo: verification.transactionNo,
                bankCode: verification.bankCode,
                cardType: verification.cardType,
                payDate: verification.payDate,
                orderInfo: verification.orderInfo,
                rawPayload: verification.rawPayload
            }
        });

        return res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
