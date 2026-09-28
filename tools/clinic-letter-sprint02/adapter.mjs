import { pathToFileURL } from "node:url";
import { handleJob, JOB_TYPES, DEMO_JOB_TYPES } from "./worker.mjs";

export const PROCESS_IDS = Object.freeze(["Process_ClinicLetterSprint02", "Process_ClinicLetterSprint02Demo"]);
const FETCH_VARIABLES = Object.freeze(["clinicLetterId", "consultationCompletedAt", "clinicalApproved", "recipientChecked", "administrativeDetailsChecked", "clinicalCorrectionRequested", "simulateDispatchError", "simulateTechnicalFailuresRemaining", "letterType", "clinicalSummary", "followUpPlan", "diagnosis", "clinicalFindings", "treatmentDecisions", "communicationInstructions", "intendedRecipients", "delayReason"]);

function localBase(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['/v2', '/v2/'].includes(url.pathname)) {
    throw new Error("Only a credential-free loopback /v2 endpoint is allowed");
  }
  return url.href.replace(/\/$/, "");
}

function jobKey(value) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Unsafe job key");
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error("Invalid job key");
  if (BigInt(value) > 9223372036854775807n) throw new Error("Job key is outside signed 64-bit range");
  return String(value);
}

// API shape: Camunda 8.6+ /v2. Offline mocked tests are not engine acceptance evidence.
// Explicit opt-in is necessary because activation/completion mutate the local engine.
export function createLocalAdapter({ enabled = false, baseUrl = "http://localhost:8080/v2", fetchImpl = globalThis.fetch,
  processDefinitionId = "Process_ClinicLetterSprint02Demo", now = () => new Date(), auditHook = async () => {} } = {}) {
  if (enabled !== true) throw new Error("Adapter disabled; explicit enabled:true required");
  const base = localBase(baseUrl);
  if (!PROCESS_IDS.includes(processDefinitionId)) throw new Error("Unsupported Clinic Letter process id");
  const selectedTypes = Object.values(processDefinitionId === PROCESS_IDS[1] ? DEMO_JOB_TYPES : JOB_TYPES);
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");
  if (typeof auditHook !== "function") throw new TypeError("auditHook must be a function");
  async function post(path, body) {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Camunda ${path} returned HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }

  async function activate(type) {
    if (!selectedTypes.includes(type)) throw new Error("Unsupported isolated job type");
    const response = await post("/jobs/activation", { type, worker: "clinic-letter-sprint02-simulated-worker", timeout: 30000,
      maxJobsToActivate: 1, requestTimeout: -1, fetchVariable: [...FETCH_VARIABLES] });
    if (!response || !Array.isArray(response.jobs) || response.jobs.length > 1) throw new Error("Unexpected activation response");
    return response.jobs;
  }

  async function processJob(job, expectedType = job.type) {
    if (!selectedTypes.includes(expectedType) || job.type !== expectedType || job.processDefinitionId !== processDefinitionId) {
      // Never complete/fail jobs outside this selected isolated process.
      throw new Error("Job is outside the selected Clinic Letter process/type");
    }
    const key = jobKey(job.jobKey);
    const context = { jobKey: key, processInstanceKey: String(job.processInstanceKey ?? ""), type: job.type,
      at: now().toISOString(), actor: "simulated-local-worker" };
    async function mutate(path, body, action) {
      await auditHook({ ...context, phase: "INTENT", action });
      try {
        await post(path, body);
      } catch (error) {
        await auditHook({ ...context, phase: "UNKNOWN", action });
        throw error;
      }
      await auditHook({ ...context, phase: "ACK", action });
    }
    let result;
    try {
      result = handleJob(job.type, job.variables, now());
    } catch {
      // Invalid inputs need manual correction: no futile retries, no sensitive values in logs.
      await mutate(`/jobs/${key}/failure`, { retries: 0, retryBackOff: 0, errorMessage: "Invalid Clinic Letter demo input; correct variables and resolve incident" }, "invalid-input-incident");
      return { action: "fail", jobKey: key };
    }
    const metadataFields = ["draftStartedAt", "draftCompletedAt", "approvedAt", "administrativeProcessedAt", "letterSentAt",
      "distributionMethod", "dispatchStatus", "reminderStatus", "lastReminderAt", "oneMonthEscalatedAt", "threeMonthEscalatedAt",
      "oneMonthNotificationStatus", "threeMonthNotificationStatus"];
    context.metadata = Object.fromEntries(Object.entries(result.variables ?? {}).filter(([name]) => metadataFields.includes(name)));
    if (typeof job.variables?.delayReason === "string") context.delayReason = job.variables.delayReason;
    if (result.action === "fail") {
      if (!Number.isInteger(job.retries) || job.retries <= 0) throw new Error("Missing valid engine retry count; no failure write made");
      const retries = job.retries - 1;
      await mutate(`/jobs/${key}/failure`, { retries, retryBackOff: result.retryBackOff,
        errorMessage: result.errorMessage, variables: result.variables }, "technical-failure");
      return { action: "fail", jobKey: key, simulated: true, technical: true, retriesLeft: retries };
    } else if (result.action === "throwBpmnError") {
      await mutate(`/jobs/${key}/error`, { errorCode: result.errorCode, errorMessage: result.errorMessage }, "business-error");
    } else {
      await mutate(`/jobs/${key}/completion`, { variables: result.variables }, "complete");
    }
    // HTTP failures propagate without a second write: outcome may be uncertain, do not blindly retry.
    return { action: result.action, jobKey: key, simulated: true };
  }

  async function runOnce() {
    const results = [];
    for (const type of selectedTypes) {
      for (const job of await activate(type)) results.push(await processJob(job, type));
    }
    return results;
  }
  return Object.freeze({ activate, processJob, runOnce });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--local-once") {
    console.error("Safety stop: adapter is off. --local-once explicitly mutates a local demo engine; no real email is sent.");
    process.exitCode = 2;
  } else {
    try {
      const adapter = createLocalAdapter({ enabled: true });
      console.log(JSON.stringify(await adapter.runOnce(), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
