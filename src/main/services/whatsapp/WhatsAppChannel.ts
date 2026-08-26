import type { WhatsAppProvider } from '../../../contracts/security-domain';

export class NullWhatsAppAdapter implements WhatsAppProvider {
  async send(_to: string, _message: string): Promise<void> {
    void _to;
    void _message;
  }
}

export class TwilioWhatsAppAdapter implements WhatsAppProvider {
  constructor(
    private accountSid: string,
    private authToken: string,
    private from: string,
    private fetchFn: typeof fetch = fetch
  ) {}

  async send(to: string, message: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
      From: this.from,
      Body: message,
    });
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    try {
      await this.fetchFn(url, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      /* never throw into the request path */
    }
  }
}

export function createWhatsAppProvider(env: {
  WHATSAPP_PROVIDER?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
}): WhatsAppProvider {
  if (
    String(env.WHATSAPP_PROVIDER || '').toLowerCase() === 'twilio' &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WHATSAPP_FROM
  ) {
    return new TwilioWhatsAppAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_WHATSAPP_FROM);
  }
  return new NullWhatsAppAdapter();
}
