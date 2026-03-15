// generate-hash.js - Generate bcrypt hash for Password123!
const bcrypt = require('bcryptjs');

async function generateHash() {
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 10);
  console.log('\n=================================');
  console.log('Password:', password);
  console.log('Bcrypt Hash:');
  console.log(hash);
  console.log('=================================\n');
  console.log('Copy hash này vào seed_data.sql');
  console.log('Thay thế tất cả "$2a$10$YourHashedPasswordHere" bằng hash trên\n');
}

generateHash();
