const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const requestStorage = new AsyncLocalStorage();
const SAFE_CORRELATION_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

function normalizeCorrelationId(value) {
  const candidate = String(value || '').trim();
  return SAFE_CORRELATION_ID.test(candidate) ? candidate : crypto.randomUUID();
}

function requestContext(req, res, next) {
  const correlationId = normalizeCorrelationId(req.get('x-correlation-id'));
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  requestStorage.run({ correlationId }, next);
}

function getCorrelationId() {
  return requestStorage.getStore()?.correlationId || null;
}

module.exports = { getCorrelationId, normalizeCorrelationId, requestContext };
