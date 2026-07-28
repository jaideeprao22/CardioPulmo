'use strict';
/* Server-side configuration. None of these values may ever reach the browser.
   Read once at module load so a misconfigured deployment fails on the first request
   rather than intermittently, deep inside a data path. */

function required(name) {
  var v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error('Server misconfigured: ' + name + ' is not set');
  }
  return String(v).trim();
}

var CACHE = null;

function env() {
  if (CACHE) return CACHE;
  CACHE = {
    url: required('POSTBASE_URL').replace(/\/+$/, ''),
    projectId: required('POSTBASE_PROJECT_ID'),
    serviceKey: required('POSTBASE_SERVICE_KEY')
  };
  return CACHE;
}

module.exports = { env: env };
