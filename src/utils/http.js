function buildSuccessPayload({ data, message, meta } = {}) {
  const payload = { success: true };

  if (typeof data !== 'undefined') {
    payload.data = data;
  }

  if (typeof message !== 'undefined') {
    payload.message = message;
  }

  if (typeof meta !== 'undefined') {
    payload.meta = meta;
  }

  return payload;
}

function buildErrorPayload({ code = 'BAD_REQUEST', message = 'Request failed', details } = {}) {
  const payload = {
    success: false,
    error: {
      code,
      message
    }
  };

  if (typeof details !== 'undefined') {
    payload.error.details = details;
  }

  return payload;
}

function sendSuccess(res, { status = 200, data, message, meta } = {}) {
  return res.status(status).json(buildSuccessPayload({ data, message, meta }));
}

function sendError(res, { status = 400, code = 'BAD_REQUEST', message = 'Request failed', details } = {}) {
  return res.status(status).json(buildErrorPayload({ code, message, details }));
}

function sendNoCompany(res, message = 'No company associated with this user', status = 404) {
  return sendError(res, {
    status,
    code: 'NO_COMPANY',
    message
  });
}

function parsePositiveInt(value, fallback) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

module.exports = {
  buildSuccessPayload,
  buildErrorPayload,
  sendSuccess,
  sendError,
  sendNoCompany,
  parsePositiveInt
};
