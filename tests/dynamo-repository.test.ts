import { describe, expect, it } from "vitest";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DynamoRepository } from "@/lib/aws/dynamo-repository";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Play, Reward } from "@/types";

/**
 * DynamoDB Local isn't available in CI here, so these tests pin down the exact conditional
 * writes the production repository issues — the guarantees against overselling and duplicates.
 */
type Sent = { name: string; input: Record<string, unknown> };

function fakeClient(respond: (cmd: Sent) => unknown = () => ({})) {
  const sent: Sent[] = [];
  const client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const s = { name: cmd.constructor.name, input: cmd.input };
      sent.push(s);
      const r = respond(s);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, sent };
}

const reward: Reward = {
  reward_id: "rwd_1", sponsor_id: "spn_1", name: "₹500 Voucher", description: "", type: "VOUCHER", total_limit: 100, daily_limit: 20, remaining_inventory: 100,
  claimed_count: 0, redeemed_count: 0, active: true, valid_from: null, valid_until: null, redeem_from: null, redeem_until: null, fallback: false, weight: 1, created_at: "", updated_at: "",
};
const play: Play = {
  play_id: "ply_1", session_id: "a".repeat(32), source_id: "H001", box_index: 0, reward_id: "rwd_1", sponsor_id: "spn_1", coupon_code: "BUB-ABCDEF", status: "HELD",
  day_key: "2026-10-15", hold_expires_at: "2026-10-15T06:20:00.000Z", participant_id: null, created_at: "2026-10-15T06:00:00.000Z", updated_at: "2026-10-15T06:00:00.000Z",
};
const coupon = {
  coupon_id: "cpn_1", coupon_code: "BUB-ABCDEF", participant_id: null, play_id: "ply_1", sponsor_id: "spn_1", reward_id: "rwd_1", status: "ISSUED" as const,
  issued_at: play.created_at, claimed_at: null, redeemed_at: null, redeemed_by: null, valid_from: null, valid_until: null, created_at: play.created_at, updated_at: play.created_at,
};

function cancelled(codes: string[]) {
  return new TransactionCanceledException({ message: "cancelled", $metadata: {}, CancellationReasons: codes.map((Code) => ({ Code })) });
}

describe("DynamoRepository — atomic inventory hold", () => {
  it("issues one transaction guarding inventory, daily limit, play, coupon uniqueness and session", async () => {
    const { client, sent } = fakeClient();
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await repo.holdReward({ play, coupon, reward, dayKey: "2026-10-15" });
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("TransactWriteCommand");
    const items = sent[0].input.TransactItems as Array<Record<string, { ConditionExpression: string; Key?: Record<string, string>; Item?: Record<string, unknown> }>>;
    expect(items).toHaveLength(5);
    expect(items[0].Update.Key).toEqual({ PK: "REWARD#rwd_1", SK: "META" });
    expect(items[0].Update.ConditionExpression).toBe("#a = :true AND #ri > :zero");
    expect(items[1].Update.Key).toEqual({ PK: "REWARD#rwd_1", SK: "DAY#2026-10-15" });
    expect(items[1].Update.ConditionExpression).toBe("attribute_not_exists(#c) OR #c < :limit");
    expect(items[2].Put.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(items[2].Put.Item).toMatchObject({ PK: "PLAY#ply_1", GSI2PK: "HOLDS", GSI2SK: play.hold_expires_at });
    expect(items[3].Put.Item).toMatchObject({ PK: "COUPON#BUB-ABCDEF", GSI2PK: "SPONSOR#spn_1" });
    expect(items[3].Put.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(items[4].Update.ConditionExpression).toContain("attribute_not_exists(#p) OR #p = :null");
  });

  it.each([
    [["ConditionalCheckFailed", "None", "None", "None", "None"], "INVENTORY"],
    [["None", "ConditionalCheckFailed", "None", "None", "None"], "DAILY_LIMIT"],
    [["None", "None", "None", "ConditionalCheckFailed", "None"], "COUPON_CODE_COLLISION"],
    [["None", "None", "None", "None", "ConditionalCheckFailed"], "SESSION_ALREADY_PLAYED"],
  ])("maps cancellation %j to %s", async (codes, reason) => {
    const { client } = fakeClient(() => cancelled(codes));
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await expect(repo.holdReward({ play, coupon, reward, dayKey: "2026-10-15" })).rejects.toMatchObject({ reason });
  });

  it("unlimited fallback rewards only condition on active and skip the inventory decrement", async () => {
    const { client, sent } = fakeClient();
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await repo.holdReward({ play: { ...play, coupon_code: null }, coupon: null, reward: { ...reward, total_limit: null, remaining_inventory: null, daily_limit: null }, dayKey: "x" });
    const items = sent[0].input.TransactItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(Object.keys(items[0])).toEqual(["ConditionCheck"]);
  });
});

describe("DynamoRepository — claims, entries, redemption", () => {
  it("claim locks the phone number with a conditional write in the same transaction", async () => {
    const { client, sent } = fakeClient();
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await repo.claimReward({ play, participantId: "par_1", phone: "+919876543210", now: "2026-10-15T06:05:00.000Z" });
    const items = sent[0].input.TransactItems as Array<Record<string, { ConditionExpression?: string; Key: Record<string, string>; UpdateExpression: string }>>;
    expect(items[0].Update.Key).toEqual({ PK: "PHONE#+919876543210", SK: "LOCK" });
    expect(items[0].Update.ConditionExpression).toBe("attribute_exists(PK) AND #rc = :false");
    expect(items[1].Update.ConditionExpression).toBe("#s = :held");
    expect(items[1].Update.UpdateExpression).toContain("REMOVE GSI2PK, GSI2SK");
    expect(items[3].Update.ConditionExpression).toBe("#s = :issued");
  });

  it("maps a lost phone lock to PHONE_ALREADY_CLAIMED", async () => {
    const { client } = fakeClient(() => cancelled(["ConditionalCheckFailed", "None", "None", "None", "None"]));
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await expect(repo.claimReward({ play, participantId: "par_1", phone: "+919876543210", now: "x" })).rejects.toMatchObject({ reason: "PHONE_ALREADY_CLAIMED" });
  });

  it("lucky draw entry is conditional on the participant having no entry yet", async () => {
    const { client, sent } = fakeClient((c) => (c.name === "TransactWriteCommand" ? cancelled(["None", "ConditionalCheckFailed"]) : {}));
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await expect(repo.createLuckyDrawEntry({ entry_id: "BUB-LD-123456", participant_id: "par_1", source_id: null, entered_at: "x", created_at: "x" }, {})).rejects.toMatchObject({ reason: "ALREADY_ENTERED" });
    const items = sent[0].input.TransactItems as Array<Record<string, { ConditionExpression: string }>>;
    expect(items[1].Update.ConditionExpression).toContain("attribute_not_exists(#ld) OR #ld = :null");
  });

  it("redemption requires status CLAIMED and bumps redeemed_count atomically", async () => {
    const { client, sent } = fakeClient((c) => (c.name === "GetCommand" ? { Item: { PK: "COUPON#BUB-ABCDEF", SK: "META", ...coupon, status: "CLAIMED" } } : {}));
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await repo.redeemCoupon("BUB-ABCDEF", "admin", "now");
    const tx = sent.find((s) => s.name === "TransactWriteCommand")!;
    const items = tx.input.TransactItems as Array<Record<string, { ConditionExpression?: string; UpdateExpression: string }>>;
    expect(items[0].Update.ConditionExpression).toBe("#s = :claimed");
    expect(items[1].Update.UpdateExpression).toBe("ADD #rc :one");
  });

  it("admin quantity changes can't push remaining inventory below zero", async () => {
    const { client, sent } = fakeClient(() => ({ Attributes: { ...reward } }));
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    await repo.updateReward("rwd_1", { name: "x" }, -30);
    const input = sent[0].input as { ConditionExpression: string; ExpressionAttributeValues: Record<string, unknown>; UpdateExpression: string };
    expect(input.ConditionExpression).toBe("attribute_exists(PK) AND #ri >= :minRem");
    expect(input.ExpressionAttributeValues[":minRem"]).toBe(30);
    expect(input.UpdateExpression).toContain("#tl = #tl + :delta, #ri = #ri + :delta");
  });

  it("strips key attributes from returned records", async () => {
    const { client } = fakeClient(() => ({ Item: { PK: "SOURCE#H001", SK: "META", GSI1PK: "TYPE#SOURCE", entity: "Source", source_id: "H001" } }));
    const repo = new DynamoRepository({ tableName: "t", region: "ap-south-1", campaignId: "c", client });
    expect(await repo.getSource("H001")).toEqual({ source_id: "H001" });
  });
});
