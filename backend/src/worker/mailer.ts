import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';
import type { ClaimedEmail } from '../emails/emails.repository';

// One SMTP transport per sender, created on first use and reused. `pool: true`
// keeps SMTP connections open between emails instead of reconnecting (TCP + TLS
// + login) for every single message.
const transports = new Map<string, Transporter>();

function transportFor(sender: ClaimedEmail['sender']): Transporter {
  let transport = transports.get(sender.id);
  if (!transport) {
    transport = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpPort === 465, // 465 = TLS from the first byte; 587 upgrades with STARTTLS
      auth: { user: sender.smtpUser, pass: sender.smtpPass },
      pool: true,
      maxConnections: 2,
    });
    transports.set(sender.id, transport);
  }
  return transport;
}

export async function sendEmail(email: ClaimedEmail): Promise<{ messageId: string; previewUrl: string | null }> {
  const info: SentMessageInfo = await transportFor(email.sender).sendMail({
    from: { name: email.sender.name, address: email.sender.email },
    to: email.recipient,
    subject: email.subject,
    text: email.body,
  });
  // Ethereal only: a link where the delivered message can be viewed in a browser.
  const previewUrl = nodemailer.getTestMessageUrl(info);
  return { messageId: info.messageId, previewUrl: previewUrl || null };
}

export function closeTransports(): void {
  for (const transport of transports.values()) transport.close();
  transports.clear();
}
