import nodemailer from 'nodemailer';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
};

type GmailSmtpEmailServiceConfig = {
  user?: string;
  appPassword?: string;
};

export class GmailSmtpEmailService {
  private readonly transporter;

  constructor(private readonly config: GmailSmtpEmailServiceConfig) {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: config.user,
        pass: config.appPassword,
      },
    });
  }

  isConfigured(): boolean {
    return Boolean(this.config.user && this.config.appPassword);
  }

  async send({ to, subject, text, html, attachments }: SendEmailInput): Promise<string[]> {
    if (!this.isConfigured()) {
      throw new Error('Integração Gmail SMTP não configurada.');
    }

    const recipients = Array.isArray(to) ? to : [to];

    const messageIds: string[] = [];
    for (const recipient of recipients) {
      const result = await this.transporter.sendMail({
        from: this.config.user,
        to: recipient,
        subject,
        text,
        html,
        attachments,
      });
      messageIds.push(result.messageId);
    }
    return messageIds;
  }
}
