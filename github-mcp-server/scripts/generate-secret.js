#!/usr/bin/env node

/**
 * Simple script to generate a secure random string for use as JWT secret
 */

const crypto = require('crypto');

const generateSecret = (length = 64) => {
  return crypto.randomBytes(length).toString('hex');
};

console.log('Generated JWT Secret:');
console.log(generateSecret());
console.log('\nAdd this to your .env file as JWT_SECRET=your_secret_here'); 