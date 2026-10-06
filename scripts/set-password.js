// Usage: npm run set-password            (prompts, input hidden)
//        PHOTOLIB_PASSWORD=... npm run set-password
import readline from 'node:readline';
import { hashPassword } from '../src/auth.js';
import { setSetting } from '../src/db.js';

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl.question(question, (answer) => { rl._writeToOutput = write; rl.close(); process.stdout.write('\n'); resolve(answer); });
    rl._writeToOutput = (s) => { if (s.includes(question)) write.call(rl, s); }; // hide typed characters
  });
}

let password = process.env.PHOTOLIB_PASSWORD;
if (!password) {
  password = await ask('New admin password (min 10 characters): ');
  const again = await ask('Repeat password: ');
  if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
}
if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }
setSetting('admin_password', hashPassword(password));
console.log('Admin password saved.');
