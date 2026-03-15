const { body } = require('express-validator');

const upgradeSubscriptionValidation = [
    body('target_plan')
        .isIn(['trial', 'standard', 'export'])
        .withMessage('Invalid plan. Must be trial, standard, or export'),

    body('standard_sku_limit')
        .optional()
        .custom((value) => [20, 35, 50].includes(Number(value)))
        .withMessage('standard_sku_limit must be one of 20, 35 or 50'),

    body('standard_sku_limit')
        .custom((value, { req }) => {
            if (req.body?.target_plan !== 'standard') {
                return true;
            }
            return [20, 35, 50].includes(Number(value));
        })
        .withMessage('standard_sku_limit is required for target_plan=standard and must be 20, 35 or 50'),

    body('billing_cycle')
        .isIn(['monthly'])
        .withMessage('Invalid billing cycle. Only monthly (30 days) is supported'),

    body('payment_provider')
        .optional()
        .isIn(['vnpay'])
        .withMessage('Invalid payment provider. Must be vnpay')
];

module.exports = {
    upgradeSubscriptionValidation
};
