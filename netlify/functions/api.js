// netlify/functions/api.js
//
// Netlify Function entry point for the Soapbox Laundry API.
//
// How it works:
//   1. Netlify receives a request to /api/* (e.g. /api/checkout).
//   2. netlify.toml redirects it to /.netlify/functions/api/*.
//   3. This file loads your Express app from server/index.js.
//   4. serverless-http translates the Netlify event into an Express request,
//      runs it through your routes, and translates the response back.
//
// You do NOT need to change any of your Express routes. They work as-is.

import serverless from 'serverless-http';
import app from '../../server/index.js';

export const handler = serverless(app, {
  // Ensures Netlify's base64-encoded body is decoded correctly,
  // which is critical for the Paystack webhook signature check.
  binary: false,
});