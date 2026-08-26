import type { EmailTransport, EmailTransportResult } from '../../../contracts/email-domain';

export class ResendTransport implements EmailTransport {
  constructor(private apiKey: string) {}

  async send(input: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<EmailTransportResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        reply_to: input.replyTo,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      const err = new Error(body.message || body.name || `RESEND_${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return { id: String(body.id || '') };
  }
}

export class MemoryEmailTransport implements EmailTransport {
  sent: Array<{ from: string; to: string[]; subject: string; html: string; replyTo?: string }> = [];
  failTimes = 0;
  failForever = false;

  async send(input: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<EmailTransportResult> {
    if (this.failForever || this.failTimes > 0) {
      if (this.failTimes > 0) this.failTimes -= 1;
      throw new Error('RESEND_MOCK_FAIL');
    }
    this.sent.push(input);
    return { id: `re_mock_${this.sent.length}` };
  }
}
