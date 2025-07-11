const serverless = require('serverless-http');

// Import the Express application
const expressApp = require('../../backend/index.js');

module.exports.handler = serverless(expressApp);