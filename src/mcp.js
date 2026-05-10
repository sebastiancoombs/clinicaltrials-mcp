// Minimal MCP Streamable HTTP transport (JSON-RPC 2.0 over POST /mcp).
// tools/list returns the unpaid catalog; tools/call returns the synthetic
// x402 envelope so an x402-aware client can settle and retry against the
// REST endpoint.

const PROTOCOL_VERSION = "2025-06-18";
const NETWORK = "base";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const TOOLS = [
  {
    name: "trials_search",
    description:
      "Search ClinicalTrials.gov v2 for registered clinical studies by free-text query, phase (PHASE1/PHASE2/PHASE3/PHASE4/EARLY_PHASE1/NA), and overall status (RECRUITING, ACTIVE_NOT_RECRUITING, COMPLETED, TERMINATED). Returns flat rows: nct_id, brief_title, overall_status, phase, study_type, conditions, lead_sponsor, start_date, ui_url. Costs $0.05 USDC on Base via x402.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string" },
        phase: { type: "string" },
        status: { type: "string" },
        size: { type: "number" },
      },
    },
    _route: "/v1/trials/search",
    _method: "GET",
    _price: "$0.05",
  },
  {
    name: "trials_by_nct",
    description:
      "Fetch the full ClinicalTrials.gov record for a single study by NCT id. Returns flattened protocol: identification, status, sponsors + collaborators, design (allocation/masking/purpose), eligibility criteria/age/gender, interventions, primary + secondary outcomes, locations, FDA-regulation flags, results-availability flag, brief + detailed description. Costs $0.05 USDC on Base via x402.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["nct"],
      properties: {
        nct: { type: "string" },
      },
    },
    _route: "/v1/trials/by_nct",
    _method: "GET",
    _price: "$0.05",
  },
  {
    name: "sponsors_pipeline",
    description:
      "Aggregate the public clinical-trial pipeline of a lead sponsor (pharma, biotech, university, NIH institute). Returns phase + overall-status histograms plus the underlying flat trial rows for downstream filtering. Useful for competitive landscape, due-diligence, and sponsor portfolio mapping. Costs $0.07 USDC on Base via x402.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sponsor"],
      properties: {
        sponsor: { type: "string" },
        size: { type: "number" },
      },
    },
    _route: "/v1/sponsors/pipeline",
    _method: "GET",
    _price: "$0.07",
  },
];

function jsonrpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function jsonrpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id, error: err };
}

function originFromRequest(c) {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function priceToAtomicUsdc(priceStr) {
  const dollars = Number(String(priceStr).replace(/[^0-9.]/g, ""));
  return String(Math.round(dollars * 1_000_000));
}

function syntheticX402Envelope({ tool, originUrl, payTo }) {
  const resource = `${originUrl}${tool._route}`;
  return {
    x402Version: 1,
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        maxAmountRequired: priceToAtomicUsdc(tool._price),
        resource,
        description: tool.description,
        mimeType: "application/json",
        payTo: payTo || "0x1664530DC2A1CA350B1dbaD1Fc1F1a70c90fe4de",
        maxTimeoutSeconds: 60,
        asset: BASE_USDC,
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
}

async function handleSingle(c, msg) {
  const { id, method, params } = msg || {};

  if (method === "initialize") {
    return jsonrpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: {
        name: "clinicaltrials-mcp",
        version: "0.1.0",
        title: "ClinicalTrials.gov MCP (x402)",
      },
      instructions:
        "Pay-per-call MCP for ClinicalTrials.gov v2 (study search, study by NCT id, sponsor pipeline). Tools require x402 USDC payment on Base. tools/call returns a 402 envelope; settle X-PAYMENT and retry against the REST endpoint.",
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "tools/list") {
    const tools = TOOLS.map(({ name, description, inputSchema, _price }) => ({
      name,
      description,
      inputSchema,
      annotations: { x402_price: _price, x402_network: "base" },
    }));
    return jsonrpcResult(id, { tools });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) return jsonrpcError(id, -32602, `Unknown tool: ${toolName}`);

    const origin = originFromRequest(c);
    const payTo =
      (typeof process !== "undefined" && process.env?.PAY_TO_ADDRESS) || undefined;
    const envelope = syntheticX402Envelope({ tool, originUrl: origin, payTo });

    return jsonrpcResult(id, {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `Payment required: ${tool._price} USDC on Base via x402. ` +
            `Settle the x402 envelope below by signing X-PAYMENT, then ${tool._method} your arguments to ${origin}${tool._route}. ` +
            `Repo: https://github.com/sebastiancoombs/clinicaltrials-mcp`,
        },
        { type: "text", text: JSON.stringify(envelope, null, 2) },
      ],
      structuredContent: {
        x402: envelope,
        retry_endpoint: `${origin}${tool._route}`,
        retry_method: tool._method,
        price: tool._price,
        network: NETWORK,
      },
    });
  }

  if (method === "ping") return jsonrpcResult(id, {});

  return jsonrpcError(id, -32601, `Method not found: ${method}`);
}

export async function mcpHandler(c) {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      400
    );
  }
  if (Array.isArray(body)) {
    const results = [];
    for (const msg of body) {
      const r = await handleSingle(c, msg);
      if (r) results.push(r);
    }
    return c.json(results);
  }
  const r = await handleSingle(c, body);
  if (r === null) return c.body(null, 204);
  return c.json(r);
}

export function mcpInfoHandler(c) {
  return c.json({
    transport: "streamable-http",
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: { name: "clinicaltrials-mcp", version: "0.1.0" },
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      price: t._price,
      method: t._method,
      route: t._route,
    })),
    note: "POST JSON-RPC 2.0 to this URL (initialize, tools/list, tools/call).",
  });
}
