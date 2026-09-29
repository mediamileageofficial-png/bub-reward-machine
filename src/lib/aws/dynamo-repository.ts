import { DynamoDBClient, TransactionCanceledException, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { ConditionFailedError, notFound } from "@/lib/errors";
import { epochSeconds, now as clockNow } from "@/lib/time";
import { emptyStats } from "@/lib/db/memory";
import type {
  CampaignStats,
  Coupon,
  CouponStatus,
  DashboardUser,
  LuckyDrawDraw,
  LuckyDrawEntry,
  Participant,
  Play,
  Reward,
  Session,
  Source,
  SourceCounter,
  Sponsor,
  StatKey,
  StoryGeneration,
  StoryTemplate,
  SourceVisit,
} from "@/types";
import type { ClaimInput, HoldRewardInput, OtpRecord, PhoneLock, RateLimitResult, ReleaseHoldInput, Repository } from "@/lib/db/repository";

/**
 * Single-table DynamoDB repository.
 *
 * Table: PK (S), SK (S), TTL attribute `ttl`.
 * GSI1: GSI1PK / GSI1SK — "list all of a type" (TYPE#COUPON, TYPE#PARTICIPANT, ...)
 * GSI2: GSI2PK / GSI2SK — sponsor scoping (SPONSOR#id → REWARD#…, COUPON#…) and the sparse
 *       HOLDS index of plays whose reward hold is still open (for the expiry sweeper).
 *
 * See infra/dynamodb/README.md for the full access-pattern table.
 */

type Item = Record<string, unknown>;
type TxItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

const KEY_ATTRS = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK", "ttl", "entity"];

function strip<T>(item: Item | undefined): T | null {
  if (!item) return null;
  const out: Item = {};
  for (const [k, v] of Object.entries(item)) if (!KEY_ATTRS.includes(k)) out[k] = v;
  return out as T;
}

function buildSet(patch: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  let i = 0;
  for (const [k, v] of Object.entries({ ...patch, ...extra })) {
    if (v === undefined) continue;
    const n = `#f${i}`;
    const val = `:v${i}`;
    names[n] = k;
    values[val] = v;
    sets.push(`${n} = ${val}`);
    i++;
  }
  return { names, values, expr: sets.length ? `SET ${sets.join(", ")}` : "" };
}

export interface DynamoRepositoryOptions {
  tableName: string;
  region: string;
  campaignId: string;
  endpoint?: string; // e.g. http://localhost:8000 for DynamoDB Local
  credentials?: { accessKeyId: string; secretAccessKey: string };
  client?: DynamoDBDocumentClient;
}

export class DynamoRepository implements Repository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly statsKey: { PK: string; SK: string };

  constructor(opts: DynamoRepositoryOptions) {
    this.table = opts.tableName;
    this.statsKey = { PK: `CAMPAIGN#${opts.campaignId}`, SK: "STATS" };
    this.doc =
      opts.client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: opts.region, endpoint: opts.endpoint, credentials: opts.credentials }), {
        marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
      });
  }

  // ---------------- low-level helpers ----------------

  private async get<T>(PK: string, SK = "META"): Promise<T | null> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK, SK }, ConsistentRead: true }));
    return strip<T>(r.Item);
  }

  private async put(item: Item, condition?: string, failReason = "EXISTS") {
    try {
      await this.doc.send(new PutCommand({ TableName: this.table, Item: item, ConditionExpression: condition }));
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new ConditionFailedError(failReason);
      throw e;
    }
  }

  private async update<T>(PK: string, SK: string, patch: Record<string, unknown>, notFoundCode: string): Promise<T> {
    const { names, values, expr } = buildSet(patch, { updated_at: clockNow().toISOString() });
    try {
      const r = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK, SK },
          UpdateExpression: expr,
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return strip<T>(r.Attributes) as T;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw notFound(notFoundCode, "Record not found");
      throw e;
    }
  }

  private async queryAll<T>(index: "GSI1" | "GSI2", pk: string, skPrefix?: string): Promise<T[]> {
    const out: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          IndexName: index,
          KeyConditionExpression: skPrefix ? `#pk = :pk AND begins_with(#sk, :sk)` : `#pk = :pk`,
          ExpressionAttributeNames: skPrefix ? { "#pk": `${index}PK`, "#sk": `${index}SK` } : { "#pk": `${index}PK` },
          ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
          ExclusiveStartKey,
        }),
      );
      for (const it of r.Items ?? []) out.push(strip<T>(it) as T);
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** Runs a transaction; maps a cancelled condition at index i to reasons[i]. */
  private async transact(items: TxItem[], reasons: string[]) {
    try {
      await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (e) {
      if (e instanceof TransactionCanceledException) {
        const codes = (e.CancellationReasons ?? []).map((r) => r.Code ?? "None");
        const idx = codes.findIndex((c) => c === "ConditionalCheckFailed");
        if (idx >= 0) throw new ConditionFailedError(reasons[idx] ?? "CONDITION_FAILED", codes);
        if (codes.includes("TransactionConflict")) throw new ConditionFailedError("TRANSACTION_CONFLICT", codes);
      }
      throw e;
    }
  }

  // ---------------- stats ----------------

  async incrementStat(key: StatKey, by = 1) {
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: this.statsKey,
        UpdateExpression: "ADD #k :by",
        ExpressionAttributeNames: { "#k": key },
        ExpressionAttributeValues: { ":by": by },
      }),
    );
  }

  async getStats(): Promise<CampaignStats> {
    const s = await this.get<Partial<CampaignStats>>(this.statsKey.PK, this.statsKey.SK);
    return { ...emptyStats(), ...(s ?? {}) };
  }

  // ---------------- sources ----------------

  getSource(id: string) {
    return this.get<Source>(`SOURCE#${id}`);
  }
  listSources() {
    return this.queryAll<Source>("GSI1", "TYPE#SOURCE");
  }
  createSource(s: Source) {
    return this.put({ PK: `SOURCE#${s.source_id}`, SK: "META", GSI1PK: "TYPE#SOURCE", GSI1SK: s.source_id, entity: "Source", ...s }, "attribute_not_exists(PK)", "SOURCE_EXISTS");
  }
  updateSource(id: string, patch: Partial<Source>) {
    return this.update<Source>(`SOURCE#${id}`, "META", patch, "SOURCE_NOT_FOUND");
  }
  async incrementSourceCounter(id: string, counter: SourceCounter, by = 1) {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `SOURCE#${id}`, SK: "META" },
          UpdateExpression: "ADD #c :by",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: { "#c": counter },
          ExpressionAttributeValues: { ":by": by },
        }),
      );
    } catch (e) {
      if (!(e instanceof ConditionalCheckFailedException)) throw e;
    }
  }

  recordSourceVisit(v: SourceVisit) {
    return this.put({ PK: `VISIT#${v.visit_id}`, SK: "META", GSI1PK: `VISITS#${v.source_id}`, GSI1SK: v.created_at, entity: "SourceVisit", ...v }, "attribute_not_exists(PK)", "VISIT_EXISTS");
  }
  async listSourceVisits(sourceId: string, limit: number) {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": `VISITS#${sourceId}` },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (r.Items ?? []).map((i) => strip<SourceVisit>(i) as SourceVisit);
  }

  // ---------------- sponsors ----------------

  getSponsor(id: string) {
    return this.get<Sponsor>(`SPONSOR#${id}`);
  }
  listSponsors() {
    return this.queryAll<Sponsor>("GSI1", "TYPE#SPONSOR");
  }
  createSponsor(s: Sponsor) {
    return this.put({ PK: `SPONSOR#${s.sponsor_id}`, SK: "META", GSI1PK: "TYPE#SPONSOR", GSI1SK: s.name, entity: "Sponsor", ...s }, "attribute_not_exists(PK)", "SPONSOR_EXISTS");
  }
  updateSponsor(id: string, patch: Partial<Sponsor>) {
    return this.update<Sponsor>(`SPONSOR#${id}`, "META", patch, "SPONSOR_NOT_FOUND");
  }

  // ---------------- rewards ----------------

  getReward(id: string) {
    return this.get<Reward>(`REWARD#${id}`);
  }
  listRewards() {
    return this.queryAll<Reward>("GSI1", "TYPE#REWARD");
  }
  listRewardsBySponsor(sponsorId: string) {
    return this.queryAll<Reward>("GSI2", `SPONSOR#${sponsorId}`, "REWARD#");
  }
  createReward(r: Reward) {
    return this.put(
      { PK: `REWARD#${r.reward_id}`, SK: "META", GSI1PK: "TYPE#REWARD", GSI1SK: r.created_at, GSI2PK: `SPONSOR#${r.sponsor_id}`, GSI2SK: `REWARD#${r.reward_id}`, entity: "Reward", ...r },
      "attribute_not_exists(PK)",
      "REWARD_EXISTS",
    );
  }
  async updateReward(id: string, patch: Partial<Reward>, totalDelta = 0) {
    const { names, values, expr } = buildSet(patch, { updated_at: clockNow().toISOString() });
    let update = expr;
    let condition = "attribute_exists(PK)";
    if (totalDelta !== 0) {
      names["#tl"] = "total_limit";
      names["#ri"] = "remaining_inventory";
      values[":delta"] = totalDelta;
      values[":minRem"] = Math.max(0, -totalDelta);
      update += `, #tl = #tl + :delta, #ri = #ri + :delta`;
      condition += " AND #ri >= :minRem";
    }
    if (patch.sponsor_id) {
      names["#g2"] = "GSI2PK";
      values[":g2"] = `SPONSOR#${patch.sponsor_id}`;
      update += `, #g2 = :g2`;
    }
    try {
      const r = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `REWARD#${id}`, SK: "META" },
          UpdateExpression: update,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return strip<Reward>(r.Attributes) as Reward;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) {
        if (totalDelta !== 0 && (await this.getReward(id))) throw new ConditionFailedError("INVENTORY_BELOW_ZERO");
        throw notFound("REWARD_NOT_FOUND", "Reward not found");
      }
      throw e;
    }
  }
  async getDailyCount(rewardId: string, dayKey: string) {
    const r = await this.get<{ count?: number }>(`REWARD#${rewardId}`, `DAY#${dayKey}`);
    return r?.count ?? 0;
  }

  // ---------------- sessions ----------------

  createSession(s: Session) {
    const ttl = epochSeconds(clockNow()) + 180 * 86400;
    return this.put({ PK: `SESSION#${s.session_id}`, SK: "META", entity: "Session", ttl, ...s }, "attribute_not_exists(PK)", "SESSION_EXISTS");
  }
  getSession(id: string) {
    return this.get<Session>(`SESSION#${id}`);
  }
  updateSession(id: string, patch: Partial<Session>) {
    return this.update<Session>(`SESSION#${id}`, "META", patch, "SESSION_NOT_FOUND");
  }

  // ---------------- plays / atomic allocation ----------------

  getPlay(id: string) {
    return this.get<Play>(`PLAY#${id}`);
  }

  private playItem(p: Play): Item {
    const item: Item = { PK: `PLAY#${p.play_id}`, SK: "META", GSI1PK: "TYPE#PLAY", GSI1SK: p.created_at, entity: "Play", ...p };
    if (p.status === "HELD" && p.hold_expires_at) {
      item.GSI2PK = "HOLDS";
      item.GSI2SK = p.hold_expires_at;
    }
    return item;
  }

  private couponItem(c: Coupon): Item {
    return {
      PK: `COUPON#${c.coupon_code}`,
      SK: "META",
      GSI1PK: "TYPE#COUPON",
      GSI1SK: c.issued_at,
      GSI2PK: `SPONSOR#${c.sponsor_id}`,
      GSI2SK: `COUPON#${c.issued_at}#${c.coupon_code}`,
      entity: "Coupon",
      ...c,
    };
  }

  async holdReward({ play, coupon, reward, dayKey }: HoldRewardInput) {
    const items: TxItem[] = [];
    const reasons: string[] = [];
    const nowIso = play.created_at;

    if (reward.total_limit !== null) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `REWARD#${reward.reward_id}`, SK: "META" },
          UpdateExpression: "SET #ri = #ri - :one, #u = :now",
          ConditionExpression: "#a = :true AND #ri > :zero",
          ExpressionAttributeNames: { "#ri": "remaining_inventory", "#a": "active", "#u": "updated_at" },
          ExpressionAttributeValues: { ":one": 1, ":zero": 0, ":true": true, ":now": nowIso },
        },
      });
      reasons.push("INVENTORY");
    } else {
      items.push({
        ConditionCheck: {
          TableName: this.table,
          Key: { PK: `REWARD#${reward.reward_id}`, SK: "META" },
          ConditionExpression: "#a = :true",
          ExpressionAttributeNames: { "#a": "active" },
          ExpressionAttributeValues: { ":true": true },
        },
      });
      reasons.push("REWARD_INACTIVE");
    }

    if (reward.daily_limit !== null) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `REWARD#${reward.reward_id}`, SK: `DAY#${dayKey}` },
          UpdateExpression: "ADD #c :one",
          ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
          ExpressionAttributeNames: { "#c": "count" },
          ExpressionAttributeValues: { ":one": 1, ":limit": reward.daily_limit },
        },
      });
      reasons.push("DAILY_LIMIT");
    }

    items.push({ Put: { TableName: this.table, Item: this.playItem(play), ConditionExpression: "attribute_not_exists(PK)" } });
    reasons.push("SESSION_ALREADY_PLAYED");

    if (coupon) {
      items.push({ Put: { TableName: this.table, Item: this.couponItem(coupon), ConditionExpression: "attribute_not_exists(PK)" } });
      reasons.push("COUPON_CODE_COLLISION");
    }

    items.push({
      Update: {
        TableName: this.table,
        Key: { PK: `SESSION#${play.session_id}`, SK: "META" },
        UpdateExpression: "SET #p = :pid, #u = :now",
        ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#p) OR #p = :null)",
        ExpressionAttributeNames: { "#p": "play_id", "#u": "updated_at" },
        ExpressionAttributeValues: { ":pid": play.play_id, ":null": null, ":now": nowIso },
      },
    });
    reasons.push("SESSION_ALREADY_PLAYED");

    await this.transact(items, reasons);
  }

  async recordEmptyPlay(play: Play) {
    await this.transact(
      [
        { Put: { TableName: this.table, Item: this.playItem(play), ConditionExpression: "attribute_not_exists(PK)" } },
        {
          Update: {
            TableName: this.table,
            Key: { PK: `SESSION#${play.session_id}`, SK: "META" },
            UpdateExpression: "SET #p = :pid",
            ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#p) OR #p = :null)",
            ExpressionAttributeNames: { "#p": "play_id" },
            ExpressionAttributeValues: { ":pid": play.play_id, ":null": null },
          },
        },
      ],
      ["SESSION_ALREADY_PLAYED", "SESSION_ALREADY_PLAYED"],
    );
  }

  async claimReward({ play, participantId, phone, now }: ClaimInput) {
    const items: TxItem[] = [];
    const reasons: string[] = [];

    items.push({
      Update: {
        TableName: this.table,
        Key: { PK: `PHONE#${phone}`, SK: "LOCK" },
        UpdateExpression: "SET #rc = :true, #p = :pid, #u = :now",
        ConditionExpression: "attribute_exists(PK) AND #rc = :false",
        ExpressionAttributeNames: { "#rc": "reward_claimed", "#p": "play_id", "#u": "updated_at" },
        ExpressionAttributeValues: { ":true": true, ":false": false, ":pid": play.play_id, ":now": now },
      },
    });
    reasons.push("PHONE_ALREADY_CLAIMED");

    if (play.status === "HELD") {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `PLAY#${play.play_id}`, SK: "META" },
          UpdateExpression: "SET #s = :claimed, #pa = :part, #h = :null, #u = :now REMOVE GSI2PK, GSI2SK",
          ConditionExpression: "#s = :held",
          ExpressionAttributeNames: { "#s": "status", "#pa": "participant_id", "#h": "hold_expires_at", "#u": "updated_at" },
          ExpressionAttributeValues: { ":claimed": "CLAIMED", ":held": "HELD", ":part": participantId, ":null": null, ":now": now },
        },
      });
    } else {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `PLAY#${play.play_id}`, SK: "META" },
          UpdateExpression: "SET #pa = :part, #u = :now",
          ConditionExpression: "#s = :none AND (attribute_not_exists(#pa) OR #pa = :null)",
          ExpressionAttributeNames: { "#s": "status", "#pa": "participant_id", "#u": "updated_at" },
          ExpressionAttributeValues: { ":none": "NO_REWARD", ":part": participantId, ":null": null, ":now": now },
        },
      });
    }
    reasons.push("PLAY_NOT_HELD");

    if (play.reward_id) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `REWARD#${play.reward_id}`, SK: "META" },
          UpdateExpression: "ADD #cc :one",
          ExpressionAttributeNames: { "#cc": "claimed_count" },
          ExpressionAttributeValues: { ":one": 1 },
        },
      });
      reasons.push("REWARD_UPDATE");
    }

    if (play.coupon_code) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `COUPON#${play.coupon_code}`, SK: "META" },
          UpdateExpression: "SET #s = :claimed, #pa = :part, #ca = :now, #u = :now",
          ConditionExpression: "#s = :issued",
          ExpressionAttributeNames: { "#s": "status", "#pa": "participant_id", "#ca": "claimed_at", "#u": "updated_at" },
          ExpressionAttributeValues: { ":claimed": "CLAIMED", ":issued": "ISSUED", ":part": participantId, ":now": now },
        },
      });
      reasons.push("COUPON_NOT_ISSUED");
    }

    items.push({
      Update: {
        TableName: this.table,
        Key: { PK: `PARTICIPANT#${participantId}`, SK: "META" },
        UpdateExpression: "SET #p = :pid, #r = :rid, #c = :code, #u = :now",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#p": "play_id", "#r": "reward_id", "#c": "coupon_code", "#u": "updated_at" },
        ExpressionAttributeValues: { ":pid": play.play_id, ":rid": play.reward_id, ":code": play.coupon_code, ":now": now },
      },
    });
    reasons.push("PARTICIPANT_MISSING");

    await this.transact(items, reasons);
  }

  async releaseHold({ play, reward, now, force }: ReleaseHoldInput) {
    const items: TxItem[] = [
      {
        Update: {
          TableName: this.table,
          Key: { PK: `PLAY#${play.play_id}`, SK: "META" },
          UpdateExpression: "SET #s = :expired, #u = :now, #h = :now REMOVE GSI2PK, GSI2SK",
          ConditionExpression: force ? "#s = :held" : "#s = :held AND #h <= :now",
          ExpressionAttributeNames: { "#s": "status", "#h": "hold_expires_at", "#u": "updated_at" },
          ExpressionAttributeValues: { ":expired": "EXPIRED", ":held": "HELD", ":now": now },
        },
      },
    ];
    const reasons = ["NOT_EXPIRED_HOLD"];
    if (reward && reward.total_limit !== null) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `REWARD#${reward.reward_id}`, SK: "META" },
          UpdateExpression: "ADD #ri :one",
          ExpressionAttributeNames: { "#ri": "remaining_inventory" },
          ExpressionAttributeValues: { ":one": 1 },
        },
      });
      reasons.push("REWARD_UPDATE");
    }
    if (reward && reward.daily_limit !== null) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `REWARD#${reward.reward_id}`, SK: `DAY#${play.day_key}` },
          UpdateExpression: "ADD #c :neg",
          ConditionExpression: "#c > :zero",
          ExpressionAttributeNames: { "#c": "count" },
          ExpressionAttributeValues: { ":neg": -1, ":zero": 0 },
        },
      });
      reasons.push("DAILY_COUNTER");
    }
    if (play.coupon_code) {
      items.push({
        Update: {
          TableName: this.table,
          Key: { PK: `COUPON#${play.coupon_code}`, SK: "META" },
          UpdateExpression: "SET #s = :cancelled, #u = :now",
          ConditionExpression: "#s = :issued",
          ExpressionAttributeNames: { "#s": "status", "#u": "updated_at" },
          ExpressionAttributeValues: { ":cancelled": "CANCELLED", ":issued": "ISSUED", ":now": now },
        },
      });
      reasons.push("COUPON_NOT_ISSUED");
    }
    await this.transact(items, reasons);
  }

  async listExpiredHolds(nowIso: string, limit: number) {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :h AND GSI2SK <= :now",
        ExpressionAttributeValues: { ":h": "HOLDS", ":now": nowIso },
        Limit: limit,
      }),
    );
    return (r.Items ?? []).map((i) => strip<Play>(i) as Play);
  }

  listPlays() {
    return this.queryAll<Play>("GSI1", "TYPE#PLAY");
  }

  // ---------------- participants ----------------

  getParticipant(id: string) {
    return this.get<Participant>(`PARTICIPANT#${id}`);
  }
  getPhoneLock(phone: string) {
    return this.get<PhoneLock>(`PHONE#${phone}`, "LOCK");
  }
  async createParticipant(p: Participant) {
    const lock: PhoneLock = { phone: p.phone, participant_id: p.participant_id, reward_claimed: false, play_id: null, created_at: p.created_at, updated_at: p.created_at };
    await this.transact(
      [
        { Put: { TableName: this.table, Item: { PK: `PHONE#${p.phone}`, SK: "LOCK", entity: "PhoneLock", ...lock }, ConditionExpression: "attribute_not_exists(PK)" } },
        {
          Put: {
            TableName: this.table,
            Item: { PK: `PARTICIPANT#${p.participant_id}`, SK: "META", GSI1PK: "TYPE#PARTICIPANT", GSI1SK: p.created_at, entity: "Participant", ...p },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
      ["PHONE_EXISTS", "PARTICIPANT_EXISTS"],
    );
  }
  updateParticipant(id: string, patch: Partial<Participant>) {
    return this.update<Participant>(`PARTICIPANT#${id}`, "META", patch, "PARTICIPANT_NOT_FOUND");
  }
  listParticipants() {
    return this.queryAll<Participant>("GSI1", "TYPE#PARTICIPANT");
  }

  // ---------------- OTP ----------------

  getOtp(phone: string) {
    return this.get<OtpRecord>(`PHONE#${phone}`, "OTP");
  }
  async putOtp(o: OtpRecord) {
    const ttl = Math.floor(new Date(o.expires_at).getTime() / 1000) + 3600;
    await this.put({ PK: `PHONE#${o.phone}`, SK: "OTP", entity: "Otp", ttl, ...o });
  }
  async incrementOtpAttempts(phone: string) {
    try {
      const r = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `PHONE#${phone}`, SK: "OTP" },
          UpdateExpression: "ADD attempts :one",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":one": 1 },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      return Number(r.Attributes?.attempts ?? Number.MAX_SAFE_INTEGER);
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return Number.MAX_SAFE_INTEGER;
      throw e;
    }
  }
  async deleteOtp(phone: string) {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { PK: `PHONE#${phone}`, SK: "OTP" } }));
  }

  // ---------------- coupons ----------------

  getCoupon(code: string) {
    return this.get<Coupon>(`COUPON#${code}`);
  }
  listCoupons() {
    return this.queryAll<Coupon>("GSI1", "TYPE#COUPON");
  }
  listCouponsBySponsor(sponsorId: string) {
    return this.queryAll<Coupon>("GSI2", `SPONSOR#${sponsorId}`, "COUPON#");
  }
  async redeemCoupon(code: string, redeemedBy: string, now: string) {
    const c = await this.getCoupon(code);
    if (!c) throw new ConditionFailedError("NOT_REDEEMABLE");
    await this.transact(
      [
        {
          Update: {
            TableName: this.table,
            Key: { PK: `COUPON#${code}`, SK: "META" },
            UpdateExpression: "SET #s = :redeemed, #ra = :now, #rb = :by, #u = :now",
            ConditionExpression: "#s = :claimed",
            ExpressionAttributeNames: { "#s": "status", "#ra": "redeemed_at", "#rb": "redeemed_by", "#u": "updated_at" },
            ExpressionAttributeValues: { ":redeemed": "REDEEMED", ":claimed": "CLAIMED", ":now": now, ":by": redeemedBy },
          },
        },
        {
          Update: {
            TableName: this.table,
            Key: { PK: `REWARD#${c.reward_id}`, SK: "META" },
            UpdateExpression: "ADD #rc :one",
            ExpressionAttributeNames: { "#rc": "redeemed_count" },
            ExpressionAttributeValues: { ":one": 1 },
          },
        },
      ],
      ["NOT_REDEEMABLE", "REWARD_UPDATE"],
    );
    return (await this.getCoupon(code)) as Coupon;
  }
  async setCouponStatus(code: string, from: CouponStatus[], to: CouponStatus, now: string) {
    const values: Record<string, unknown> = { ":to": to, ":now": now };
    from.forEach((s, i) => (values[`:f${i}`] = s));
    try {
      const r = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `COUPON#${code}`, SK: "META" },
          UpdateExpression: "SET #s = :to, #u = :now",
          ConditionExpression: `#s IN (${from.map((_, i) => `:f${i}`).join(", ")})`,
          ExpressionAttributeNames: { "#s": "status", "#u": "updated_at" },
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return strip<Coupon>(r.Attributes) as Coupon;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new ConditionFailedError("STATUS_MISMATCH");
      throw e;
    }
  }

  // ---------------- lucky draw ----------------

  async createLuckyDrawEntry(entry: LuckyDrawEntry, participantPatch: Partial<Participant>) {
    const { names, values, expr } = buildSet({ ...participantPatch, lucky_draw_entry_id: entry.entry_id, updated_at: entry.created_at });
    names["#ld"] = "lucky_draw_entry_id";
    values[":null"] = null;
    await this.transact(
      [
        {
          Put: {
            TableName: this.table,
            Item: { PK: `LUCKYDRAW#${entry.entry_id}`, SK: "META", GSI1PK: "TYPE#LUCKYDRAW_ENTRY", GSI1SK: entry.entered_at, entity: "LuckyDrawEntry", ...entry },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Update: {
            TableName: this.table,
            Key: { PK: `PARTICIPANT#${entry.participant_id}`, SK: "META" },
            UpdateExpression: expr,
            ConditionExpression: "attribute_exists(PK) AND (attribute_not_exists(#ld) OR #ld = :null)",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          },
        },
      ],
      ["ENTRY_ID_COLLISION", "ALREADY_ENTERED"],
    );
  }
  getLuckyDrawEntry(id: string) {
    return this.get<LuckyDrawEntry>(`LUCKYDRAW#${id}`);
  }
  listLuckyDrawEntries() {
    return this.queryAll<LuckyDrawEntry>("GSI1", "TYPE#LUCKYDRAW_ENTRY");
  }
  listDraws() {
    return this.queryAll<LuckyDrawDraw>("GSI1", "TYPE#DRAW");
  }
  putDraw(d: LuckyDrawDraw) {
    return this.put({ PK: `DRAW#${d.draw_id}`, SK: "META", GSI1PK: "TYPE#DRAW", GSI1SK: d.selected_at, entity: "LuckyDrawDraw", ...d }, "attribute_not_exists(PK)", "DRAW_EXISTS");
  }
  async updateDraw(id: string, patch: Partial<LuckyDrawDraw>, expectedStatus?: LuckyDrawDraw["status"]) {
    const { names, values, expr } = buildSet(patch, { updated_at: clockNow().toISOString() });
    let condition = "attribute_exists(PK)";
    if (expectedStatus) {
      names["#st"] = "status";
      values[":exp"] = expectedStatus;
      condition += " AND #st = :exp";
    }
    try {
      const r = await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `DRAW#${id}`, SK: "META" },
          UpdateExpression: expr,
          ConditionExpression: condition,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return strip<LuckyDrawDraw>(r.Attributes) as LuckyDrawDraw;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) throw new ConditionFailedError("DRAW_STATUS_CHANGED");
      throw e;
    }
  }

  // ---------------- story ----------------

  async listStoryTemplates() {
    const t = await this.queryAll<StoryTemplate>("GSI1", "TYPE#STORYTEMPLATE");
    return t.sort((a, b) => a.sort_order - b.sort_order);
  }
  getStoryTemplate(id: string) {
    return this.get<StoryTemplate>(`STORYTEMPLATE#${id}`);
  }
  putStoryTemplate(t: StoryTemplate) {
    return this.put({ PK: `STORYTEMPLATE#${t.template_id}`, SK: "META", GSI1PK: "TYPE#STORYTEMPLATE", GSI1SK: String(t.sort_order).padStart(4, "0"), entity: "StoryTemplate", ...t });
  }
  recordStoryGeneration(g: StoryGeneration) {
    return this.put({ PK: `STORYGEN#${g.generation_id}`, SK: "META", GSI1PK: "TYPE#STORYGEN", GSI1SK: g.created_at, entity: "StoryGeneration", ...g });
  }

  // ---------------- users ----------------

  getDashboardUser(id: string) {
    return this.get<DashboardUser>(`USER#${id}`);
  }
  putDashboardUser(u: DashboardUser) {
    return this.put({ PK: `USER#${u.user_id}`, SK: "META", GSI1PK: "TYPE#USER", GSI1SK: u.email, entity: "DashboardUser", ...u });
  }
  listDashboardUsers() {
    return this.queryAll<DashboardUser>("GSI1", "TYPE#USER");
  }

  // ---------------- rate limit ----------------

  async hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = clockNow().getTime();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const r = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: `RATE#${key}`, SK: `W#${windowStart}` },
        UpdateExpression: "ADD #c :one SET #t = :ttl",
        ExpressionAttributeNames: { "#c": "count", "#t": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": Math.floor((windowStart + windowMs) / 1000) + 60 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    const count = Number(r.Attributes?.count ?? 1);
    const allowed = count <= limit;
    return { allowed, count, retryAfterSeconds: allowed ? 0 : Math.ceil((windowStart + windowMs - nowMs) / 1000) };
  }
}
