/**
 * Makes sure at least N sender accounts exist (default 2).
 *   npm run seed:senders          -> at least 2 senders
 *   npm run seed:senders -- 3     -> at least 3 senders
 *
 * Each sender is a fresh Ethereal account, created through Ethereal's public API
 * (nodemailer.createTestAccount). Ethereal is a fake SMTP service: it accepts real
 * SMTP traffic but never delivers, and every message can be viewed at a preview URL.
 * Running this again only creates the missing senders.
 */
import { pool } from '../db/pool';
import { countSenders, insertSender } from './senders.repository';

async function main() {
  // By default nodemailer remembers the first test account and hands the SAME one
  // back on every later call in this process. We need a new account per sender.
  // The flag is read when nodemailer loads, so set it first, then import.
  process.env.ETHEREAL_CACHE = 'no';
  const { default: nodemailer } = await import('nodemailer');

  const wanted = Number(process.argv[2] ?? 2);
  if (!Number.isInteger(wanted) || wanted < 1) throw new Error('Usage: npm run seed:senders -- <count>');

  const existing = await countSenders();
  if (existing >= wanted) {
    console.log(`${existing} sender(s) already exist, nothing to do`);
    return;
  }

  for (let n = existing + 1; n <= wanted; n++) {
    const account = await nodemailer.createTestAccount();
    const sender = await insertSender({
      name: `Sender ${n}`,
      email: account.user,
      smtpHost: account.smtp.host,
      smtpPort: account.smtp.port,
      smtpUser: account.user,
      smtpPass: account.pass,
    });
    console.log(`Created ${sender.name}: ${sender.email}`);
  }
}

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
