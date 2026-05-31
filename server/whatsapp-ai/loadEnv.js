'use strict';

const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

function loadEnv() {
  if (loaded) return;

  const localEnvPath = path.join(__dirname, '.env');
  const parentEnvPath = path.join(__dirname, '..', '.env');

  dotenv.config({ path: localEnvPath });
  dotenv.config({ path: parentEnvPath });

  loaded = true;
}

module.exports = { loadEnv };
