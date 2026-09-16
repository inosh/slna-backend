// db/create-admin.js
// One-time script to create your first admin user with a securely
// hashed password. Run this once after setting up the database:
//
//   node db/create-admin.js
//
// It will prompt you for a username and password in the terminal.

const bcrypt = require('bcryptjs');
const readline = require('readline');
const pool = require('./pool');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('=== SLNA Admin User Setup ===');
  const username = await ask('Enter a username (e.g. admin): ');
  const password = await ask('Enter a password: ');
  const role = await ask('Enter a role (e.g. Administrator) [default: Administrator]: ') || 'Administrator';

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role',
      [username, passwordHash, role]
    );
    console.log('\nAdmin user created successfully:');
    console.log(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      console.error('\nError: A user with that username already exists.');
    } else {
      console.error('\nError creating user:', err.message);
    }
  } finally {
    rl.close();
    await pool.end();
  }
}

main();
