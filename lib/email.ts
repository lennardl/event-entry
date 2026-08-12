export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ messageId: string }>;
}

const POSTMAN_ENDPOINT = "https://api.postman.gov.sg/v1/transactional/email/send";

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export function createPostmanEmailProvider(fetcher: typeof fetch = fetch): EmailProvider {
  return {
    async send(message) {
      const apiKey = process.env.POSTMAN_EMAIL_API_KEY;
      if (!apiKey) throw new EmailDeliveryError("POSTMAN_EMAIL_API_KEY is not configured");
      const response = await fetcher(POSTMAN_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipient: message.to,
          subject: message.subject,
          body: message.html,
          classification: "FOR_ACTION",
          tag: message.tag ?? "operations-login",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await response.json().catch(() => null) as { id?: unknown; message?: unknown } | null;
      if (response.status !== 201 || typeof data?.id !== "string") {
        throw new EmailDeliveryError(`Postman rejected the email request (${response.status})`);
      }
      return { messageId: data.id };
    },
  };
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}
