# DynamoDB — single-table design

One table (`PK`, `SK`) plus two GSIs and a TTL attribute (`ttl`). All timestamps are UTC ISO-8601.
Daily-limit day buckets use the event timezone (`EVENT_TIMEZONE`, default Asia/Kolkata).

Create manually (the SAM template does this for you):

```bash
aws dynamodb create-table --cli-input-json file://infra/dynamodb/table.json
aws dynamodb update-time-to-live --table-name bub-reward-machine \
  --time-to-live-specification "Enabled=true, AttributeName=ttl"
aws dynamodb update-continuous-backups --table-name bub-reward-machine \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

## Items

| Entity | PK | SK | GSI1PK / GSI1SK | GSI2PK / GSI2SK | TTL |
|---|---|---|---|---|---|
| Campaign stats (atomic counters) | `CAMPAIGN#<id>` | `STATS` | | | |
| Source | `SOURCE#H001` | `META` | `TYPE#SOURCE` / id | | |
| Sponsor | `SPONSOR#<id>` | `META` | `TYPE#SPONSOR` / name | | |
| Reward | `REWARD#<id>` | `META` | `TYPE#REWARD` / created_at | `SPONSOR#<sid>` / `REWARD#<id>` | |
| Reward daily counter | `REWARD#<id>` | `DAY#2026-10-15` | | | |
| Session | `SESSION#<id>` | `META` | | | 180 days |
| QR / source visit (one per scan) | `VISIT#<id>` | `META` | `VISITS#H001` / created_at | | |
| Play | `PLAY#<id>` | `META` | `TYPE#PLAY` / created_at | `HOLDS` / hold_expires_at *(only while HELD)* | |
| Participant | `PARTICIPANT#<id>` | `META` | `TYPE#PARTICIPANT` / created_at | | |
| Phone lock (1 number = 1 claim) | `PHONE#+91…` | `LOCK` | | | |
| OTP (hashed) | `PHONE#+91…` | `OTP` | | | expiry + 1h |
| Coupon | `COUPON#BUB-XXXXXX` | `META` | `TYPE#COUPON` / issued_at | `SPONSOR#<sid>` / `COUPON#<issued_at>#<code>` | |
| Lucky Draw entry | `LUCKYDRAW#BUB-LD-…` | `META` | `TYPE#LUCKYDRAW_ENTRY` / entered_at | | |
| Lucky Draw draw | `DRAW#<id>` | `META` | `TYPE#DRAW` / selected_at | | |
| Story template | `STORYTEMPLATE#<id>` | `META` | `TYPE#STORYTEMPLATE` / sort | | |
| Story generation | `STORYGEN#<id>` | `META` | `TYPE#STORYGEN` / created_at | | |
| Dashboard user mapping | `USER#<cognito sub>` | `META` | `TYPE#USER` / email | | |
| Rate-limit window | `RATE#<key>` | `W#<window start>` | | | window end + 60s |

## Invariants and how they're enforced

All of these are single `TransactWriteItems` calls with condition expressions
(see `src/lib/aws/dynamo-repository.ts`). A lost condition cancels the whole transaction —
nothing is partially written.

| Invariant | Transaction |
|---|---|
| Never oversell inventory | `holdReward`: `remaining_inventory > 0 AND active = true` on the reward, decrement in the same write |
| Daily limit | `holdReward`: `attribute_not_exists(count) OR count < :daily_limit` on `DAY#…`, `ADD count 1` |
| Unique coupon codes | `holdReward`: `attribute_not_exists(PK)` on `COUPON#code` (engine retries with a new code) |
| One play per session | `holdReward`: session `play_id` must be unset |
| One claim per WhatsApp number | `claimReward`: `reward_claimed = false` on `PHONE#…/LOCK` |
| Claim only a live hold | `claimReward`: play `status = HELD`, coupon `status = ISSUED` |
| Hold expiry returns stock exactly once | `releaseHold`: play `status = HELD AND hold_expires_at <= now` |
| One Lucky Draw entry per participant | `createLuckyDrawEntry`: participant `lucky_draw_entry_id` unset + entry `attribute_not_exists` |
| Redeem once | `redeemCoupon`: coupon `status = CLAIMED`, `ADD redeemed_count 1` on the reward |
| Admin quantity edits can't go negative | `updateReward`: `remaining_inventory >= :minRemaining` |

## Scale notes

Admin list/search screens query the `TYPE#…` partitions of GSI1 and filter in Lambda. That is
comfortable for an event of this size (tens of thousands of participants). If volumes grow
well beyond that, add dedicated GSIs for the searched attributes or stream to OpenSearch.
