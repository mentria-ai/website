#!/usr/bin/env node

/**
 * Script to generate a secure random string for JWT_SECRET
 * Run with: node scripts/generate-secret.js
 */

const crypto = require('crypto');

// Generate a secure random string (64 bytes = 128 hex characters)
const generateSecret = () => {
  return crypto.randomBytes(64).toString('hex');
};

const secret = generateSecret();

console.log('\n=== JWT Secret Generator ===');
console.log('\nGenerated JWT_SECRET:');
console.log('\x1b[32m%s\x1b[0m', secret);
console.log('\nAdd this to your .env file:');
console.log('\x1b[36m%s\x1b[0m', `JWT_SECRET=${secret}`);
console.log('\nKeep this value secure and do not share it!\n');

// Export for testing purposes
module.exports = { generateSecret }; 