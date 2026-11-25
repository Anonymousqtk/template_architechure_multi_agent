import nodemailer from 'nodemailer';

export interface Mailer {
  mode: 'SMTP' | 'DEV_ONLY';
  send(to: string, subject: string, link: string): Promise<'SENT' | 'DEV_ONLY'>;
}
export function createMailer(): Mailer {
  if (!process.env.SMTP_HOST) return { mode: 'DEV_ONLY', send: async () => 'DEV_ONLY' };
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
  if (!process.env.SMTP_FROM) throw new Error('SMTP_FROM is required');
  return {
    mode: 'SMTP',
    async send(to, subject, link) {
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject,
        text: `${subject}\n\n${link}\n\nIf you did not request this, ignore this message.`,
      });
      return 'SENT';
    },
  };
}
