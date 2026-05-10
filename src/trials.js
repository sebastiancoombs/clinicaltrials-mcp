// ClinicalTrials.gov v2 fetchers.
// Docs: https://clinicaltrials.gov/data-api/api
// No key required.

const CTGOV_BASE = "https://clinicaltrials.gov/api/v2";

const UI_BASE = "https://clinicaltrials.gov/study";

function flattenStudy(s) {
  const ps = s?.protocolSection || {};
  const idMod = ps.identificationModule || {};
  const statusMod = ps.statusModule || {};
  const sponsorMod = ps.sponsorCollaboratorsModule || {};
  const designMod = ps.designModule || {};
  const condMod = ps.conditionsModule || {};

  const nctId = idMod.nctId || null;
  const phases = Array.isArray(designMod.phases) ? designMod.phases : [];

  return {
    nct_id: nctId,
    brief_title: idMod.briefTitle || null,
    official_title: idMod.officialTitle || null,
    overall_status: statusMod.overallStatus || null,
    phase: phases.length ? phases.join(",") : null,
    study_type: designMod.studyType || null,
    conditions: Array.isArray(condMod.conditions) ? condMod.conditions : [],
    lead_sponsor: sponsorMod.leadSponsor?.name || null,
    lead_sponsor_class: sponsorMod.leadSponsor?.class || null,
    start_date: statusMod.startDateStruct?.date || null,
    primary_completion_date: statusMod.primaryCompletionDateStruct?.date || null,
    completion_date: statusMod.completionDateStruct?.date || null,
    last_update_post_date: statusMod.lastUpdatePostDateStruct?.date || null,
    ui_url: nctId ? `${UI_BASE}/${nctId}` : null,
  };
}

async function ctgovGet(path, params) {
  const url = new URL(`${CTGOV_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const e = new Error(`ClinicalTrials.gov upstream ${res.status}: ${text.slice(0, 200)}`);
    e.status = res.status === 404 ? 404 : 502;
    throw e;
  }
  return res.json();
}

export async function searchTrials({ q, phase, status, size } = {}) {
  const pageSize = Math.max(1, Math.min(100, Number(size) || 25));
  const params = {
    pageSize: String(pageSize),
    format: "json",
  };
  if (q) params["query.term"] = String(q);
  if (status) params["filter.overallStatus"] = String(status);
  if (phase) {
    // ClinicalTrials.gov v2 uses Essie expression for advanced filters.
    // Phase values look like PHASE1, PHASE2, PHASE3, PHASE4, EARLY_PHASE1, NA.
    params["filter.advanced"] = `AREA[Phase]${String(phase)}`;
  }

  const data = await ctgovGet(`/studies`, params);
  const studies = Array.isArray(data?.studies) ? data.studies : [];

  return {
    source: "clinicaltrials.gov",
    query: { q: q || null, phase: phase || null, status: status || null, size: pageSize },
    total_count: typeof data?.totalCount === "number" ? data.totalCount : studies.length,
    next_page_token: data?.nextPageToken || null,
    results: studies.map(flattenStudy),
  };
}

export async function trialByNct({ nct } = {}) {
  if (!nct || !/^NCT\d+$/i.test(String(nct).trim())) {
    const e = new Error("nct parameter required (must look like NCT01234567)");
    e.status = 400;
    throw e;
  }
  const id = String(nct).trim().toUpperCase();
  const data = await ctgovGet(`/studies/${id}`, { format: "json" });
  const study = data?.studies?.[0] || data; // /studies/{id} returns the study object directly
  const ps = study?.protocolSection || {};
  const idMod = ps.identificationModule || {};
  const statusMod = ps.statusModule || {};
  const sponsorMod = ps.sponsorCollaboratorsModule || {};
  const designMod = ps.designModule || {};
  const condMod = ps.conditionsModule || {};
  const eligMod = ps.eligibilityModule || {};
  const descMod = ps.descriptionModule || {};
  const armsMod = ps.armsInterventionsModule || {};
  const outcomesMod = ps.outcomesModule || {};
  const contactsMod = ps.contactsLocationsModule || {};
  const oversightMod = ps.oversightModule || {};
  const referencesMod = ps.referencesModule || {};
  const hasResults = Boolean(study?.hasResults);
  const phases = Array.isArray(designMod.phases) ? designMod.phases : [];

  const locations = Array.isArray(contactsMod.locations)
    ? contactsMod.locations.map((l) => ({
        facility: l.facility || null,
        city: l.city || null,
        state: l.state || null,
        country: l.country || null,
        status: l.status || null,
      }))
    : [];

  const primaryOutcomes = Array.isArray(outcomesMod.primaryOutcomes)
    ? outcomesMod.primaryOutcomes.map((o) => ({
        measure: o.measure || null,
        time_frame: o.timeFrame || null,
        description: o.description || null,
      }))
    : [];
  const secondaryOutcomes = Array.isArray(outcomesMod.secondaryOutcomes)
    ? outcomesMod.secondaryOutcomes.map((o) => ({
        measure: o.measure || null,
        time_frame: o.timeFrame || null,
        description: o.description || null,
      }))
    : [];

  const interventions = Array.isArray(armsMod.interventions)
    ? armsMod.interventions.map((i) => ({
        type: i.type || null,
        name: i.name || null,
        description: i.description || null,
      }))
    : [];

  const collaborators = Array.isArray(sponsorMod.collaborators)
    ? sponsorMod.collaborators.map((c) => ({ name: c.name || null, class: c.class || null }))
    : [];

  return {
    source: "clinicaltrials.gov",
    nct_id: idMod.nctId || id,
    brief_title: idMod.briefTitle || null,
    official_title: idMod.officialTitle || null,
    overall_status: statusMod.overallStatus || null,
    phase: phases.length ? phases.join(",") : null,
    study_type: designMod.studyType || null,
    conditions: Array.isArray(condMod.conditions) ? condMod.conditions : [],
    keywords: Array.isArray(condMod.keywords) ? condMod.keywords : [],
    lead_sponsor: sponsorMod.leadSponsor?.name || null,
    lead_sponsor_class: sponsorMod.leadSponsor?.class || null,
    collaborators,
    start_date: statusMod.startDateStruct?.date || null,
    primary_completion_date: statusMod.primaryCompletionDateStruct?.date || null,
    completion_date: statusMod.completionDateStruct?.date || null,
    last_update_post_date: statusMod.lastUpdatePostDateStruct?.date || null,
    why_stopped: statusMod.whyStopped || null,
    brief_summary: descMod.briefSummary || null,
    detailed_description: descMod.detailedDescription || null,
    eligibility: {
      criteria: eligMod.eligibilityCriteria || null,
      gender: eligMod.sex || null,
      minimum_age: eligMod.minimumAge || null,
      maximum_age: eligMod.maximumAge || null,
      healthy_volunteers: eligMod.healthyVolunteers ?? null,
      std_ages: eligMod.stdAges || null,
    },
    interventions,
    primary_outcomes: primaryOutcomes,
    secondary_outcomes: secondaryOutcomes,
    enrollment_count: designMod.enrollmentInfo?.count ?? null,
    enrollment_type: designMod.enrollmentInfo?.type || null,
    allocation: designMod.designInfo?.allocation || null,
    intervention_model: designMod.designInfo?.interventionModel || null,
    masking: designMod.designInfo?.maskingInfo?.masking || null,
    primary_purpose: designMod.designInfo?.primaryPurpose || null,
    locations,
    is_fda_regulated_drug: oversightMod.isFdaRegulatedDrug ?? null,
    is_fda_regulated_device: oversightMod.isFdaRegulatedDevice ?? null,
    has_results: hasResults,
    pmids: Array.isArray(referencesMod.references)
      ? referencesMod.references.map((r) => r.pmid).filter(Boolean)
      : [],
    ui_url: idMod.nctId ? `${UI_BASE}/${idMod.nctId}` : `${UI_BASE}/${id}`,
  };
}

export async function sponsorPipeline({ sponsor, size } = {}) {
  if (!sponsor) {
    const e = new Error("sponsor parameter required");
    e.status = 400;
    throw e;
  }
  const pageSize = Math.max(1, Math.min(100, Number(size) || 25));
  const params = {
    pageSize: String(pageSize),
    format: "json",
    "query.lead": String(sponsor),
  };
  const data = await ctgovGet(`/studies`, params);
  const studies = Array.isArray(data?.studies) ? data.studies : [];

  const flat = studies.map(flattenStudy);

  // Aggregate by phase + status.
  const byPhase = {};
  const byStatus = {};
  for (const r of flat) {
    const ph = r.phase || "UNKNOWN";
    byPhase[ph] = (byPhase[ph] || 0) + 1;
    const st = r.overall_status || "UNKNOWN";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }

  return {
    source: "clinicaltrials.gov",
    query: { sponsor: String(sponsor), size: pageSize },
    total_count: typeof data?.totalCount === "number" ? data.totalCount : flat.length,
    next_page_token: data?.nextPageToken || null,
    aggregates: {
      by_phase: byPhase,
      by_overall_status: byStatus,
    },
    results: flat,
  };
}
