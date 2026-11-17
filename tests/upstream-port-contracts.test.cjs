'use strict';
const test = require('node:test');
const { checks } = require('../scripts/verify-rc9-port.cjs');
for (const [name, check] of Object.entries(checks)) test(name, check);
