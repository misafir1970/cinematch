const serverless = require('serverless-http');
const app = require('../../backend/index.js');
exports.handler = serverless(app);
