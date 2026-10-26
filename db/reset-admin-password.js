// db/reset-admin-password.js
// Resets the password for an existing admin/staff user. Prompts for the
// username and new password in the terminal (same pattern as
// create-admin.js), so the new password is never typed into a command or
// left in shell history.
//
//   node db/reset-admin-password.js

const bcrypt = require('bcryptjs');
const readline = require('readline');
const pool = require('./pool');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('=== SLNA Admin Password Reset ===');
  const username = await ask('Username to reset: ');
  const password = await ask('New password: ');

  if (!password || password.length < 8) {
    console.error('\nError: password must be at least 8 characters.');
    rl.close();
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username, role',
      [passwordHash, username]
    );

    if (result.rows.length === 0) {
      console.error('\nError: no user found with that username.');
    } else {
      console.log('\nPassword updated successfully for:');
      console.log(result.rows[0]);
    }
  } catch (err) {
    console.error('\nError updating password:', err.message);
  } finally {
    rl.close();
    await pool.end();
  }
}

main();
