import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { ServerConfig } from "@/config/server";
import type { Repository } from "@/lib/db/repository";
import { AppError, tooMany } from "@/lib/errors";
import { addSeconds, now } from "@/lib/time";
import { MetaCloudWhatsAppProvider, MockWhatsAppProvider, Msg91WhatsAppProvider } from "./providers";
import type { WhatsAppProvider, WhatsAppSendResult } from "./types";

export interface SendOtpOutcome {
  result: WhatsAppSendResult;
  mock: boolean;
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

/**
 * WhatsAppService — the only place the app talks to WhatsApp.
 * OTPs are generated and verified here (hashed at rest, attempt-limited, short-lived);
 * the provider only transports approved templates.
 */
export class WhatsAppService {
  constructor(
    private readonly provider: WhatsAppProvider,
    private readonly repo: Repository,
    private readonly cfg: ServerConfig,
  ) {}

  get isMock() {
    return this.provider.name === "mock";
  }

  private hash(phone: string, code: string) {
    return createHmac("sha256", this.cfg.sessionSecret).update(`${phone}:${code}`).digest("hex");
  }

  async sendOTP(phone: string): Promise<SendOtpOutcome> {
    const o = this.cfg.otp;
    const t = now();
    const existing = await this.repo.getOtp(phone);

    if (existing) {
      const since = (t.getTime() - new Date(existing.last_sent_at).getTime()) / 1000;
      if (since < o.resendSeconds) throw tooMany("Please wait before requesting another code.", Math.ceil(o.resendSeconds - since));
    }
    const windowFresh = existing && t.getTime() - new Date(existing.window_started_at).getTime() < 3600_000;
    const sendsInWindow = windowFresh ? existing!.sends_in_window : 0;
    if (sendsInWindow >= o.maxSendsPerHour) throw tooMany("Too many codes requested for this number. Try again later.", 3600);

    const code = this.isMock ? o.mockCode : String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.repo.putOtp({
      phone,
      code_hash: this.hash(phone, code),
      attempts: 0,
      expires_at: addSeconds(t, o.ttlSeconds).toISOString(),
      last_sent_at: t.toISOString(),
      sends_in_window: sendsInWindow + 1,
      window_started_at: windowFresh ? existing!.window_started_at : t.toISOString(),
    });

    const result = await this.provider.sendTemplate({
      to: phone,
      template: this.cfg.whatsapp.templates.otp,
      language: this.cfg.whatsapp.templateLanguage,
      bodyParams: [code],
      buttonParam: code,
    });
    if (result.status === "FAILED") {
      await this.repo.deleteOtp(phone);
      throw new AppError(502, "WHATSAPP_SEND_FAILED", "We couldn't send a WhatsApp code right now. Please try again.");
    }
    return { result, mock: this.isMock, resendAfterSeconds: o.resendSeconds, expiresInSeconds: o.ttlSeconds };
  }

  /** Returns true once for a correct, unexpired code; the code is consumed on success. */
  async verifyOTP(phone: string, code: string): Promise<boolean> {
    const rec = await this.repo.getOtp(phone);
    if (!rec) return false;
    if (new Date(rec.expires_at).getTime() < now().getTime()) return false;
    const attempts = await this.repo.incrementOtpAttempts(phone);
    if (attempts > this.cfg.otp.maxAttempts) {
      throw new AppError(429, "OTP_LOCKED", "Too many wrong attempts. Request a new code.");
    }
    const a = Buffer.from(this.hash(phone, code), "hex");
    const b = Buffer.from(rec.code_hash, "hex");
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (ok) await this.repo.deleteOtp(phone);
    return ok;
  }

  sendRewardMessage(phone: string, p: { name: string; rewardName: string; sponsorName: string }) {
    return this.provider.sendTemplate({
      to: phone,
      template: this.cfg.whatsapp.templates.reward,
      language: this.cfg.whatsapp.templateLanguage,
      bodyParams: [p.name, p.rewardName, p.sponsorName],
    });
  }

  sendCouponMessage(phone: string, p: { name: string; couponCode: string; rewardName: string; validUntil: string; couponUrl: string }) {
    return this.provider.sendTemplate({
      to: phone,
      template: this.cfg.whatsapp.templates.coupon,
      language: this.cfg.whatsapp.templateLanguage,
      bodyParams: [p.name, p.couponCode, p.rewardName, p.validUntil, p.couponUrl],
    });
  }

  sendEventReminder(phone: string, p: { name: string; eventName: string; dates: string; venue: string }) {
    return this.provider.sendTemplate({
      to: phone,
      template: this.cfg.whatsapp.templates.reminder,
      language: this.cfg.whatsapp.templateLanguage,
      bodyParams: [p.name, p.eventName, p.dates, p.venue],
    });
  }
}

export function createWhatsAppProvider(cfg: ServerConfig): WhatsAppProvider {
  if (cfg.whatsappMockMode) return new MockWhatsAppProvider();
  switch (cfg.whatsapp.provider) {
    case "meta_cloud":
      return new MetaCloudWhatsAppProvider({
        apiBaseUrl: cfg.whatsapp.apiBaseUrl,
        accessToken: cfg.whatsapp.accessToken,
        phoneNumberId: cfg.whatsapp.phoneNumberId,
      });
    case "msg91":
      return new Msg91WhatsAppProvider({
        apiBaseUrl: cfg.whatsapp.msg91ApiBaseUrl,
        authKey: cfg.whatsapp.msg91AuthKey,
        integratedNumber: cfg.whatsapp.msg91IntegratedNumber,
        namespace: cfg.whatsapp.msg91Namespace,
      });
    default:
      throw new Error(`Unknown WHATSAPP_PROVIDER "${cfg.whatsapp.provider}". Add a provider in src/lib/whatsapp/providers.ts.`);
  }
}
