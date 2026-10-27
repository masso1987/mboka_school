import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Messages "sent" with EMAIL_PROVIDER=memory (tests read them here). */
export const memoryOutbox: Mail[] = [];

/**
 * Platform e-mail (sign-up verification and account notices).
 * EMAIL_PROVIDER: `smtp` (SMTP_URL, MAIL_FROM) in production; `log` in development — logs recipient and
 * subject, and the body only outside production, because it can carry a one-time link; `memory` in tests.
 */
@Injectable()
export class Mailer {
  private readonly logger = new Logger('Mailer');
  private transport?: Transporter;

  get provider(): string {
    return process.env.EMAIL_PROVIDER ?? '';
  }

  /** Whether mail can actually reach a person (sign-up depends on it in production). */
  get deliversRealMail(): boolean {
    return this.provider === 'smtp' || process.env.NODE_ENV !== 'production';
  }

  async send(mail: Mail): Promise<void> {
    switch (this.provider) {
      case 'smtp': {
        this.transport ??= createTransport(process.env.SMTP_URL!);
        await this.transport.sendMail({ from: process.env.MAIL_FROM ?? 'Mboka School <no-reply@localhost>', to: mail.to, subject: mail.subject, text: mail.text });
        return;
      }
      case 'memory':
        memoryOutbox.push(mail);
        return;
      default:
        this.logger.log(`mail to ${mail.to}: ${mail.subject}`);
        if (process.env.NODE_ENV !== 'production') this.logger.log(mail.text);
    }
  }
}

@Global()
@Module({ providers: [Mailer], exports: [Mailer] })
export class MailerModule {}
