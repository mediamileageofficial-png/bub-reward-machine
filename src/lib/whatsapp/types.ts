/**
 * WhatsApp provider abstraction.
 *
 * Delivery honesty: a provider can only tell us it ACCEPTED a message for delivery.
 * Actual delivery/read receipts arrive later via provider webhooks (not part of V1),
 * so nothing in the app ever reports a message as "delivered".
 */
export type WhatsAppSendStatus = "MOCKED" | "ACCEPTED" | "FAILED";

export interface WhatsAppSendResult {
  status: WhatsAppSendStatus;
  provider: string;
  providerMessageId?: string;
  error?: string;
}

export interface TemplateMessage {
  to: string; // E.164
  template: string; // approved template name
  language: string;
  bodyParams: string[];
  /** For authentication templates with a copy-code / URL button. */
  buttonParam?: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendTemplate(msg: TemplateMessage): Promise<WhatsAppSendResult>;
}
