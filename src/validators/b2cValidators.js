const { param, query } = require('express-validator');

const collectionPointCategoryValidation = query('category')
  .optional()
  .isIn(['all', 'charity', 'recycle'])
  .withMessage('Category must be all, charity, or recycle');

const collectionPointSearchValidation = query('search')
  .optional()
  .isString()
  .withMessage('Search must be a string')
  .trim();

const collectionPointCityValidation = query('city')
  .optional()
  .isString()
  .withMessage('City must be a string')
  .trim();

const limitValidation = query('limit')
  .optional()
  .isInt({ min: 1, max: 100 })
  .withMessage('Limit must be between 1 and 100')
  .toInt();

const donationIdValidation = param('id')
  .isUUID()
  .withMessage('Donation id must be a valid UUID');

const listCollectionPointsValidation = [
  collectionPointCategoryValidation,
  collectionPointSearchValidation,
  collectionPointCityValidation,
  limitValidation
];

const listNearbyCollectionPointsValidation = [
  query('lat')
    .notEmpty()
    .withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90')
    .toFloat(),
  query('lng')
    .notEmpty()
    .withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180')
    .toFloat(),
  collectionPointCategoryValidation,
  collectionPointSearchValidation,
  collectionPointCityValidation,
  limitValidation
];

const listDonationsValidation = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
    .toInt()
];

const listRewardTransactionsValidation = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt()
];

const donationParamsValidation = [donationIdValidation];

module.exports = {
  listCollectionPointsValidation,
  listNearbyCollectionPointsValidation,
  listDonationsValidation,
  listRewardTransactionsValidation,
  donationParamsValidation
};
