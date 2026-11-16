'use strict';

const { makeConfig } = require(
  process.env.UNFOLD_RELEASE_CONFIG ||
    require('node:path').join(__dirname, '../../scripts/release-config'),
);

module.exports = makeConfig({ monorepo: { name: 'unfold-site' } });
