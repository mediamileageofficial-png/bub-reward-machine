import { getServerConfig, type ServerConfig } from "@/config/server";
import { getRepository } from "@/lib/db";
import type { Repository } from "@/lib/db/repository";
import { createWhatsAppProvider, WhatsAppService } from "@/lib/whatsapp/service";
import type { WhatsAppProvider } from "@/lib/whatsapp/types";

/** Everything a service needs. Built once per process; tests build their own. */
export interface AppContext {
  repo: Repository;
  cfg: ServerConfig;
  whatsapp: WhatsAppService;
}

const g = globalThis as unknown as { __bubCtx?: Promise<AppContext> };

export function getContext(): Promise<AppContext> {
  if (!g.__bubCtx) {
    g.__bubCtx = (async () => {
      const cfg = getServerConfig();
      const repo = await getRepository();
      return { repo, cfg, whatsapp: new WhatsAppService(createWhatsAppProvider(cfg), repo, cfg) };
    })();
  }
  return g.__bubCtx;
}

export function createContext(repo: Repository, cfg: ServerConfig = getServerConfig(), provider?: WhatsAppProvider): AppContext {
  return { repo, cfg, whatsapp: new WhatsAppService(provider ?? createWhatsAppProvider(cfg), repo, cfg) };
}

/** Test hook. */
export function setContext(ctx: AppContext | null) {
  g.__bubCtx = ctx ? Promise.resolve(ctx) : undefined;
}
