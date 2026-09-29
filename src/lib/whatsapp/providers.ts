import { logger } from "@/lib/logger";
import { maskPhone } from "@/lib/phone";
import type { TemplateMessage, WhatsAppProvider, WhatsAppSendResult } from "./types";

/** WHATSAPP_MOCK_MODE=true — logs the message and sends nothing. */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";
  readonly outbox: TemplateMessage[] = [];

  async sendTemplate(msg: TemplateMessage): Promise<WhatsAppSendResult> {
    this.outbox.push(msg);
    if (this.outbox.length > 500) this.outbox.shift();
    // Params are logged in mock mode only, to help local testing (mock OTP is always 123456).
    logger.info("whatsapp.mock.send", { to: maskPhone(msg.to), template: msg.template, params: msg.bodyParams });
    return { status: "MOCKED", provider: this.name };
  }
}

/**
 * WhatsApp Business Cloud API (Meta) compatible provider.
 * Many Indian BSPs expose the same /{phone-number-id}/messages contract; point
 * WHATSAPP_API_BASE_URL at the BSP if needed, or add another provider class here.
 */
export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta_cloud";

  constructor(
    private readonly opts: { apiBaseUrl: string; accessToken: string; phoneNumberId: string; timeoutMs?: number },
  ) {}

  async sendTemplate(msg: TemplateMessage): Promise<WhatsAppSendResult> {
    const components: unknown[] = [];
    if (msg.bodyParams.length) {
      components.push({ type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text })) });
    }
    if (msg.buttonParam) {
      components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: msg.buttonParam }] });
    }
    const body = {
      messaging_product: "whatsapp",
      to: msg.to.replace(/^\+/, ""),
      type: "template",
      template: { name: msg.template, language: { code: msg.language }, components },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const res = await fetch(`${this.opts.apiBaseUrl}/${this.opts.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
      const id = json.messages?.[0]?.id;
      if (res.ok && id) return { status: "ACCEPTED", provider: this.name, providerMessageId: id };
      logger.warn("whatsapp.send.failed", { to: maskPhone(msg.to), template: msg.template, http: res.status, error: json.error?.message });
      return { status: "FAILED", provider: this.name, error: json.error?.message ?? `HTTP ${res.status}` };
    } catch (e) {
      logger.error("whatsapp.send.error", { to: maskPhone(msg.to), template: msg.template, error: (e as Error).message });
      return { status: "FAILED", provider: this.name, error: (e as Error).name === "AbortError" ? "timeout" : "network_error" };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * MSG91 WhatsApp provider (template messages via MSG91's outbound-message API).
 *
 * STAGING CHECK: MSG91 generates a sample request for each approved template in its dashboard
 * (WhatsApp → Templates → "API"). Compare it with `buildMsg91Body` below — in particular the
 * component keys (body_1, body_2 …, button_1) and `namespace` — before switching mock mode off.
 */
export function buildMsg91Body(msg: TemplateMessage, opts: { integratedNumber: string; namespace: string }) {
  const components: Record<string, unknown> = {};
  msg.bodyParams.forEach((value, i) => (components[`body_${i + 1}`] = { type: "text", value }));
  if (msg.buttonParam) components.button_1 = { subtype: "url", type: "text", value: msg.buttonParam };
  return {
    integrated_number: opts.integratedNumber,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: msg.template,
        language: { code: msg.language, policy: "deterministic" },
        ...(opts.namespace ? { namespace: opts.namespace } : {}),
        to_and_components: [{ to: [msg.to.replace(/^\+/, "")], components }],
      },
    },
  };
}

export class Msg91WhatsAppProvider implements WhatsAppProvider {
  readonly name = "msg91";

  constructor(private readonly opts: { apiBaseUrl: string; authKey: string; integratedNumber: string; namespace: string; timeoutMs?: number }) {}

  async sendTemplate(msg: TemplateMessage): Promise<WhatsAppSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 8000);
    try {
      const res = await fetch(`${this.opts.apiBaseUrl}/api/v5/whatsapp/whatsapp-outbound-message/bulk/`, {
        method: "POST",
        headers: { authkey: this.opts.authKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildMsg91Body(msg, this.opts)),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { status?: string; hasError?: boolean; request_id?: string; data?: unknown; errors?: unknown; message?: string };
      const accepted = res.ok && json.status === "success" && !json.hasError;
      if (accepted) return { status: "ACCEPTED", provider: this.name, providerMessageId: json.request_id ?? (typeof json.data === "string" ? json.data : undefined) };
      const error = typeof json.errors === "string" ? json.errors : json.message ?? `HTTP ${res.status}`;
      logger.warn("whatsapp.msg91.failed", { to: maskPhone(msg.to), template: msg.template, http: res.status, error });
      return { status: "FAILED", provider: this.name, error };
    } catch (e) {
      logger.error("whatsapp.msg91.error", { to: maskPhone(msg.to), template: msg.template, error: (e as Error).message });
      return { status: "FAILED", provider: this.name, error: (e as Error).name === "AbortError" ? "timeout" : "network_error" };
    } finally {
      clearTimeout(timer);
    }
  }
}
