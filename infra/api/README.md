# API deployment (API Gateway HTTP API + Lambda)

- Route table: `src/lib/api/routes.ts` (the same code Next.js runs locally)
- Lambda adapter: `infra/lambda/api.ts` · scheduled hold sweeper: `infra/lambda/sweeper.ts`
- Infrastructure: `infra/template.yaml` (AWS SAM) — HTTP API with a single `ANY /api/{proxy+}` route,
  stage throttling (200 rps / 400 burst), access logs, reserved concurrency 200.
- Contract: `docs/API.md`

```bash
npm run build:lambda                       # → infra/lambda/dist/{api,sweeper}/index.mjs
cd infra && sam deploy --guided            # first time; afterwards: sam deploy
```

Point the website at it by setting `API_PROXY_URL` (the `ApiUrl` stack output) in Amplify.
Next.js then proxies `/api/*` to API Gateway, so the browser stays same-origin (cookies, no CORS).
If you ever expose API Gateway directly to browsers instead, set `TRUST_PROXY_HEADERS=false`
(so clients can't spoof `X-Forwarded-For` to dodge rate limits) and add CORS on the HTTP API.
