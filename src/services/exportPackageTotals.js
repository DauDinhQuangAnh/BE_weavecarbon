function packageFactor(pkg, field) {
  const basis = field === 'weight' ? pkg?.weightMeasurementBasis : pkg?.dimensionMeasurementBasis;
  return basis === 'group_total' ? 1 : Number(pkg?.quantity || 1);
}

function packageNetTotal(pkg) {
  return Number(pkg?.netWeightKg || 0) * packageFactor(pkg, 'weight');
}

function packageGrossTotal(pkg) {
  return Number(pkg?.grossWeightKg || 0) * packageFactor(pkg, 'weight');
}

function packageCbmTotal(pkg) {
  return Number(pkg?.lengthCm || 0) * Number(pkg?.widthCm || 0) * Number(pkg?.heightCm || 0)
    * packageFactor(pkg, 'dimension') / 1000000;
}

module.exports = {
  packageFactor,
  packageNetTotal,
  packageGrossTotal,
  packageCbmTotal
};
