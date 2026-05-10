import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";
import { paidCallsCapture, mountPaidCallsAdmin } from "./paid-calls.js";
import { unknownRouteCapture, mountUnknownRoutesAdmin } from "./unknown-routes.js";
import { createFacilitatorConfig } from "@coinbase/x402";
import { searchTrials, trialByNct, sponsorPipeline } from "./trials.js";
import { mcpHandler, mcpInfoHandler } from "./mcp.js";

import agentCard from "./static/.well-known/agent-card.json" with { type: "json" };
import mcpManifest from "./static/.well-known/mcp.json" with { type: "json" };
import aiPlugin from "./static/.well-known/ai-plugin.json" with { type: "json" };
import openapiYaml from "./static/openapi.yaml";
import agentDiscoveryHtml from "./static/agent-discovery.html";

const PAY_TO = process.env.PAY_TO_ADDRESS;
const NETWORK = process.env.X402_NETWORK || "base";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL;
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

const FACILITATOR =
  CDP_API_KEY_ID && CDP_API_KEY_SECRET
    ? createFacilitatorConfig(CDP_API_KEY_ID, CDP_API_KEY_SECRET)
    : FACILITATOR_URL
    ? { url: FACILITATOR_URL }
    : undefined;

const SERVICE_SLUG = "clinicaltrials-mcp";
const PRICE_BY_PATH = {
  "/v1/trials/search": 50000,
  "/v1/trials/by_nct": 50000,
  "/v1/sponsors/pipeline": 70000,
};

const app = new Hono();

app.get("/healthz", (c) =>
  c.json({
    ok: true,
    service: "clinicaltrials-mcp",
    sources: ["clinicaltrials.gov"],
  })
);

// Discovery surfaces — UNPAID. Mounted before the paywall.
app.get("/.well-known/agent-card.json", (c) => c.json(agentCard));
app.get("/.well-known/mcp.json", (c) => c.json(mcpManifest));
app.get("/.well-known/ai-plugin.json", (c) => c.json(aiPlugin));
app.get("/openapi.yaml", (c) =>
  c.text(openapiYaml, 200, { "content-type": "application/yaml" })
);
app.get("/agent-discovery", (c) => c.html(agentDiscoveryHtml));

// MCP transport — unpaid (catalog discovery).
app.get("/mcp", mcpInfoHandler);
app.post("/mcp", mcpHandler);

app.get("/", (c) =>
  c.json({
    service: "clinicaltrials-mcp",
    version: "0.1.0",
    description:
      "x402 MCP for ClinicalTrials.gov v2 — pay-per-call USDC on Base. Query the live registry of every U.S./international clinical trial: search, fetch by NCT id, sponsor pipeline aggregation. No signup, no API key.",
    sources: {
      "clinicaltrials.gov":
        "ClinicalTrials.gov v2 REST API (api/v2/studies) — ~500K registered studies, NIH/FDA-mandated registration; sponsors, phases, conditions, eligibility, outcomes, results.",
    },
    endpoints: {
      "GET /v1/trials/search": { price: "$0.05", network: NETWORK, source: "clinicaltrials.gov" },
      "GET /v1/trials/by_nct": { price: "$0.05", network: NETWORK, source: "clinicaltrials.gov" },
      "GET /v1/sponsors/pipeline": { price: "$0.07", network: NETWORK, source: "clinicaltrials.gov" },
    },
    pay_to: PAY_TO || null,
    repo: "https://github.com/sebastiancoombs/clinicaltrials-mcp",
  })
);

if (PAY_TO) {
  app.use(
    paymentMiddleware(
      PAY_TO,
      {
        "GET /v1/trials/search": {
          price: "$0.05",
          network: NETWORK,
          config: {
            description:
              "Search ClinicalTrials.gov v2 for registered clinical studies by free-text query, phase (PHASE1/PHASE2/PHASE3/PHASE4/EARLY_PHASE1/NA), and overall status (RECRUITING, ACTIVE_NOT_RECRUITING, COMPLETED, TERMINATED, etc.). Returns flat rows: nctId, briefTitle, overallStatus, phase, studyType, conditions, leadSponsor, startDate, ui_url. $0.05 USDC on Base.",
            discoverable: true,
            inputSchema: {
              queryParams: {
                q: { type: "string", description: "Free-text query term", example: "glioblastoma" },
                phase: {
                  type: "string",
                  description: "Phase filter (PHASE1|PHASE2|PHASE3|PHASE4|EARLY_PHASE1|NA)",
                  example: "PHASE3",
                },
                status: {
                  type: "string",
                  description: "Overall status filter (RECRUITING|ACTIVE_NOT_RECRUITING|COMPLETED|TERMINATED|...)",
                  example: "RECRUITING",
                },
                size: { type: "number", description: "Page size (1–100, default 25)", example: 25 },
              },
            },
            outputSchema: {
              example: {
                source: "clinicaltrials.gov",
                total_count: 1287,
                results: [
                  {
                    nct_id: "NCT01234567",
                    brief_title: "A Phase 3 Study of Acme-101 in Glioblastoma",
                    overall_status: "RECRUITING",
                    phase: "PHASE3",
                    study_type: "INTERVENTIONAL",
                    conditions: ["Glioblastoma"],
                    lead_sponsor: "Acme Therapeutics",
                    start_date: "2024-03-15",
                    ui_url: "https://clinicaltrials.gov/study/NCT01234567",
                  },
                ],
              },
            },
          },
        },
        "GET /v1/trials/by_nct": {
          price: "$0.05",
          network: NETWORK,
          config: {
            description:
              "Fetch the full ClinicalTrials.gov record for a single study by NCT id. Returns flattened protocol section: identification, status, sponsors + collaborators, design (allocation/masking/purpose), eligibility criteria + age + gender, interventions, primary/secondary outcomes, locations, FDA-regulation flags, results-availability flag. $0.05 USDC on Base.",
            discoverable: true,
            inputSchema: {
              queryParams: {
                nct: { type: "string", description: "NCT id (NCT followed by digits)", example: "NCT04368728" },
              },
            },
            outputSchema: {
              example: {
                source: "clinicaltrials.gov",
                nct_id: "NCT04368728",
                brief_title: "Phase 3 Trial — Acme-101",
                overall_status: "COMPLETED",
                phase: "PHASE3",
                lead_sponsor: "Acme Therapeutics",
                conditions: ["COVID-19"],
                eligibility: {
                  criteria: "Inclusion: ...",
                  gender: "ALL",
                  minimum_age: "18 Years",
                  maximum_age: "85 Years",
                },
                primary_outcomes: [
                  { measure: "Efficacy at day 28", time_frame: "28 days", description: "Composite endpoint" },
                ],
                locations: [{ facility: "Acme Hospital", city: "Boston", state: "MA", country: "United States" }],
                has_results: true,
                ui_url: "https://clinicaltrials.gov/study/NCT04368728",
              },
            },
          },
        },
        "GET /v1/sponsors/pipeline": {
          price: "$0.07",
          network: NETWORK,
          config: {
            description:
              "Aggregate the public clinical-trial pipeline of a lead sponsor (pharma company, biotech, university, NIH institute). Wraps query.lead= on ClinicalTrials.gov v2 and returns phase + status histograms plus the underlying flat rows for downstream filtering. Useful for due-diligence, competitive landscape, and sponsor portfolio mapping. $0.07 USDC on Base.",
            discoverable: true,
            inputSchema: {
              queryParams: {
                sponsor: {
                  type: "string",
                  description: "Lead sponsor name (substring match against ClinicalTrials.gov sponsor index)",
                  example: "Pfizer",
                },
                size: { type: "number", description: "Page size (1–100, default 25)", example: 25 },
              },
            },
            outputSchema: {
              example: {
                source: "clinicaltrials.gov",
                query: { sponsor: "Pfizer", size: 25 },
                total_count: 1842,
                aggregates: {
                  by_phase: { PHASE1: 6, PHASE2: 7, PHASE3: 5, PHASE4: 2, NA: 5 },
                  by_overall_status: { RECRUITING: 9, COMPLETED: 11, ACTIVE_NOT_RECRUITING: 5 },
                },
                results: [
                  {
                    nct_id: "NCT01234567",
                    brief_title: "Trial A",
                    overall_status: "RECRUITING",
                    phase: "PHASE3",
                    lead_sponsor: "Pfizer",
                    conditions: ["Pneumococcal Infection"],
                    start_date: "2024-09-01",
                    ui_url: "https://clinicaltrials.gov/study/NCT01234567",
                  },
                ],
              },
            },
          },
        },
      },
      FACILITATOR
    )
  );
  // Capture X-PAYMENT-RESPONSE → paid_calls D1.
  app.use(paidCallsCapture({ service: SERVICE_SLUG, priceByPath: PRICE_BY_PATH }));
  console.log(
    `[startup] facilitator=${
      CDP_API_KEY_ID && CDP_API_KEY_SECRET
        ? "coinbase-cdp"
        : FACILITATOR_URL || "x402.org-default"
    }`
  );
} else {
  console.warn("[startup] PAY_TO_ADDRESS not set — running in UNPAID mode.");
}

app.get("/v1/trials/search", async (c) => {
  const { q, phase, status, size } = c.req.query();
  try {
    const out = await searchTrials({ q, phase, status, size });
    return c.json(out);
  } catch (e) {
    const status = e.status || 500;
    return c.json({ error: "trials_search_failed", message: String(e.message || e) }, status);
  }
});

app.get("/v1/trials/by_nct", async (c) => {
  const { nct } = c.req.query();
  try {
    const out = await trialByNct({ nct });
    return c.json(out);
  } catch (e) {
    const status = e.status || 500;
    return c.json({ error: "trial_by_nct_failed", message: String(e.message || e) }, status);
  }
});

app.get("/v1/sponsors/pipeline", async (c) => {
  const { sponsor, size } = c.req.query();
  try {
    const out = await sponsorPipeline({ sponsor, size });
    return c.json(out);
  } catch (e) {
    const status = e.status || 500;
    return c.json({ error: "sponsors_pipeline_failed", message: String(e.message || e) }, status);
  }
});

mountPaidCallsAdmin(app);
mountUnknownRoutesAdmin(app);

// 404 catch-all (must be LAST — captures every unmatched request).
app.notFound(unknownRouteCapture({ service: SERVICE_SLUG }));

export { app };
