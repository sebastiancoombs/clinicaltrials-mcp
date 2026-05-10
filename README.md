# clinicaltrials-mcp

Pay-per-call x402 MCP for [ClinicalTrials.gov v2](https://clinicaltrials.gov/data-api/api). Three GET endpoints, USDC on Base, no signup, no API key.

**Live:** https://clinicaltrials-mcp.mtree.workers.dev

## Endpoints

| Endpoint | Price | Source |
| --- | --- | --- |
| `GET /v1/trials/search?q=&phase=&status=&size=` | $0.05 | ClinicalTrials.gov v2 study search |
| `GET /v1/trials/by_nct?nct=NCT04368728` | $0.05 | Single-study record (eligibility, outcomes, locations) |
| `GET /v1/sponsors/pipeline?sponsor=Pfizer&size=` | $0.07 | Sponsor pipeline aggregation (phase + status histograms) |

All three endpoints return HTTP 402 with an x402 EXACT-scheme envelope on first call:

- `network`: `base`
- `asset`: USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- `payTo`: `0x1664530DC2A1CA350B1dbaD1Fc1F1a70c90fe4de`

Settle the envelope (sign EXACT-scheme USDC payment on Base) and retry with `X-PAYMENT` header to receive the data.

## Discovery surfaces

- `/.well-known/agent-card.json` — Google A2A AgentCard
- `/.well-known/mcp.json` — MCP server manifest
- `/.well-known/ai-plugin.json` — OpenAI plugin manifest
- `/openapi.yaml` — OpenAPI 3.1 spec (with `x-pricing` extension)
- `/agent-discovery` — human-readable HTML index
- `/mcp` — MCP Streamable HTTP transport (JSON-RPC 2.0; `tools/call` returns the synthetic 402 envelope)

## Quick start

```bash
# Search for Phase 3 recruiting cancer trials
curl -i 'https://clinicaltrials-mcp.mtree.workers.dev/v1/trials/search?q=cancer&phase=PHASE3&status=RECRUITING&size=10'

# Fetch a single study
curl -i 'https://clinicaltrials-mcp.mtree.workers.dev/v1/trials/by_nct?nct=NCT04368728'

# Aggregate Pfizer's clinical pipeline
curl -i 'https://clinicaltrials-mcp.mtree.workers.dev/v1/sponsors/pipeline?sponsor=Pfizer&size=25'
```

First call returns 402 with the x402 envelope. Settle and retry with `X-PAYMENT`.

## Why

ClinicalTrials.gov is fully open at the source, but the agent-friendly access pattern isn't: nested protocol-section schemas, multi-page flow control, and you have to walk `studies[].protocolSection.identificationModule.nctId` yourself. This service is the x402-native door — agents pay USDC for flat agent-callable rows, no human onboarding.

## Stack

- [Hono](https://hono.dev) on Cloudflare Workers
- [x402-hono](https://github.com/coinbase/x402) payment middleware
- D1 binding for paid-call capture (queue-side analytics)

## Local dev

```bash
npm install
npx wrangler secret put PAY_TO_ADDRESS   # 0x1664530DC2A1CA350B1dbaD1Fc1F1a70c90fe4de
npm run wrangler:dev
```

## License

MIT — see [LICENSE](./LICENSE).
