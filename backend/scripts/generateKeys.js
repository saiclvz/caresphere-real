// Prints fresh secrets for .env. Run once per installation.
const crypto = require('crypto');
const hex = () => crypto.randomBytes(32).toString('hex');
console.log(`JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`PHI_ENCRYPTION_KEY=${hex()}`);
console.log(`QR_ENCRYPTION_KEY=${hex()}`);
console.log(`RECEIPT_SIGNING_KEY=${hex()}`);
console.log('\n# Store PHI_ENCRYPTION_KEY safely: losing it makes existing health records unreadable.');
