const express = require('express');
const emailService = require('../services/emailService');
const validate = require('../middleware/validator');
const asyncHandler = require('../utils/asyncHandler');
const { sendError, sendSuccess } = require('../utils/http');
const { contactLeadValidation } = require('../validators/contactValidators');

const router = express.Router();
const LANDING_CONTACT_RECIPIENT =
  process.env.LANDING_CONTACT_RECIPIENT_EMAIL || 'haianh12345678901234@gmail.com';

router.post(
  '/lead',
  contactLeadValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    const emailSent = await emailService.sendLandingLeadEmails(
      email,
      LANDING_CONTACT_RECIPIENT
    );

    if (!emailSent) {
      return sendError(res, {
        status: 502,
        code: 'EMAIL_SEND_FAILED',
        message: 'Unable to send contact emails right now. Please try again.'
      });
    }

    return sendSuccess(res, {
      status: 201,
      data: {
        email
      },
      message: 'Contact request submitted successfully'
    });
  })
);

module.exports = router;
