import { readFile, writeFile, appendFile, mkdir, open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createLocalAdapter, PROCESS_IDS } from "./adapter.mjs";
import { DEMO_JOB_TYPES } from "./worker.mjs";
import { createHistoryCollector } from "./audit-history.mjs";

const base = "http://127.0.0.1:8080/v2";
const root = new URL("./", import.meta.url);
const resources = ["clinic-letter-sprint02.bpmn", "clinic-letter-sprint02-demo.bpmn",
  "forms/clinic-letter-draft-sprint02.form", "forms/clinic-letter-clinical-approval-sprint02.form",
  "forms/clinic-letter-admin-check-sprint02.form", "forms/clinic-letter-dispatch-retry-sprint02.form"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let deployedDemoKey;
let journalIds;
const key = value => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsafe numeric engine key");
  if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error("Invalid engine key");
  return String(value);
};

export function parseArgs(args) {
  if (!["deploy", "test", "prepare", "worker"].includes(args[0]) || args[1] !== "--local-demo") {
    throw new Error("Safety stop: use deploy|test|prepare|worker --local-demo. Default is off; no real email.");
  }
  if (args[0] === "worker") {
    if (args.length !== 4 || args[2] !== "--minutes" || !/^[1-9][0-9]*$/.test(args[3]) || Number(args[3]) > 30) {
      throw new Error("Worker requires --minutes 1..30");
    }
    return { command: "worker", minutes: Number(args[3]) };
  }
  if (args.length !== 2) throw new Error("Unexpected arguments; no action taken");
  return { command: args[0] };
}

async function api(path, body, method = "POST") {
  const response = await fetch(base + path, { method, redirect: "error", credentials: "omit",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function save(name, data) {
  await mkdir(new URL("evidence/", root), { recursive: true });
  await writeFile(new URL("evidence/" + name, root), JSON.stringify(data, null, 2) + "\n");
}

async function journal(entry) {
  await mkdir(new URL("evidence/", root), { recursive: true });
  if (!journalIds) journalIds = (async () => {
    try {
      const text = await readFile(new URL("evidence/demo-history.jsonl", root), "utf8");
      return new Set(text.split("\n").filter(Boolean).map(line => JSON.parse(line).eventId).filter(Boolean));
    } catch (error) { if (error.code === "ENOENT") return new Set(); throw error; }
  })();
  const ids = await journalIds;
  if (entry.eventId && ids.has(entry.eventId)) return;
  await appendFile(new URL("evidence/demo-history.jsonl", root), JSON.stringify({ recordedAt: new Date().toISOString(), ...entry }) + "\n");
  if (entry.eventId) ids.add(entry.eventId);
}

async function sourceHash() {
  const hash = createHash("sha256");
  for (const name of [...resources, "worker.mjs", "adapter.mjs"]) {
    hash.update(name); hash.update(await readFile(new URL(name, root)));
  }
  return hash.digest("hex");
}

async function deploymentMatches() {
  const deployment = JSON.parse(await readFile(new URL("evidence/current-deployment.json", root), "utf8"));
  if (deployment.sourceSha256 !== await sourceHash()) throw new Error("Sources changed; explicitly deploy before testing or preparing a new instance");
  const definitions = deployment.response.deployments.map(d => d.processDefinition).filter(d => d?.processDefinitionId === PROCESS_IDS[1]);
  if (definitions.length !== 1) throw new Error("Deployment record does not uniquely identify the demo model");
  deployedDemoKey = key(definitions[0].processDefinitionKey);
  return deployment;
}

function completeRows(result, label) {
  if (!Array.isArray(result.items) || result.page?.hasMoreTotalItems === true || !Number.isSafeInteger(result.page?.totalItems)
      || result.page.totalItems > result.items.length) throw new Error(label + " result is partial; refusing an incomplete scope/evidence check");
  return result.items;
}

async function deploy() {
  const form = new FormData();
  for (const name of resources) form.append("resources", new Blob([await readFile(new URL(name, root))]), name.split("/").pop());
  const response = await fetch(base + "/deployments", { method: "POST", redirect: "error", credentials: "omit", body: form, signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Deploy HTTP ${response.status}: ${text.slice(0, 1200)}`);
  const record = { at: new Date().toISOString(), sourceSha256: await sourceHash(), response: JSON.parse(text) };
  await save("current-deployment.json", record);
  await save("deployment-" + Date.now() + ".json", record);
  console.log("DEPLOYED", record.response.deploymentKey);
  return record;
}

async function activeDemo() {
  const result = await api("/process-instances/search", { filter: { processDefinitionId: PROCESS_IDS[1], state: "ACTIVE" }, page: { limit: 100 } });
  return completeRows(result, "Active demo");
}

async function state(instance) { return api("/process-instances/" + key(instance), undefined, "GET"); }
async function tasks(instance, taskState = "CREATED") {
  return completeRows(await api("/user-tasks/search", { filter: { processInstanceKey: key(instance), state: taskState }, page: { limit: 100 } }), "User task");
}
async function variables(instance) {
  const result = await api("/variables/search", { filter: { processInstanceKey: key(instance), scopeKey: key(instance) }, page: { limit: 100 } });
  completeRows(result, "Variable");
  const decoded = {};
  for (const item of result.items) {
    // Only persist workflow metadata, not clinical text or contact addresses.
    if (["clinicLetterId", "clinicalApproved", "recipientChecked", "administrativeDetailsChecked", "clinicalCorrectionRequested",
      "draftStartedAt", "draftCompletedAt", "approvedAt", "administrativeProcessedAt", "letterSentAt", "distributionMethod", "dispatchStatus"].includes(item.name)) {
      try { decoded[item.name] = JSON.parse(item.value); } catch { decoded[item.name] = item.value; }
    }
  }
  return decoded;
}

async function remember(instance) {
  const path = new URL("evidence/local-state.json", root);
  let saved = { instances: [] };
  try { saved = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  saved.instances.push(key(instance));
  await save("local-state.json", saved);
}

function adapterFor(owned) {
  const adapter = createLocalAdapter({ enabled: true, baseUrl: base, auditHook: journal });
  async function activate(type) {
    const jobs = await adapter.activate(type);
    for (const job of jobs) {
      if (!owned.has(key(job.processInstanceKey)) || !/^DEMO-CL-PERSONAL-/.test(job.variables?.clinicLetterId ?? "")) {
        throw new Error("Activated an unowned demo job; refusing completion/failure. Its activation will expire.");
      }
    }
    return jobs;
  }
  async function runOnce() {
    const results = [];
    for (const type of Object.values(DEMO_JOB_TYPES)) for (const job of await activate(type)) results.push(await adapter.processJob(job, type));
    return results;
  }
  return { activate, runOnce, processJob: adapter.processJob };
}

async function create(name, overrides = {}) {
  if (!deployedDemoKey) throw new Error("Explicit matching deployment required before creating an instance");
  const clinicLetterId = `DEMO-CL-PERSONAL-${name}-${Date.now()}`;
  const created = await api("/process-instances", { processDefinitionKey: deployedDemoKey, variables: {
    clinicLetterId, consultationCompletedAt: new Date().toISOString(), simulateDispatchError: false,
    simulateTechnicalFailuresRemaining: 0, clinicalCorrectionRequested: false, delayReason: "", ...overrides
  } });
  const row = { name, clinicLetterId, processInstanceKey: key(created.processInstanceKey), steps: [], status: "RUNNING" };
  await remember(row.processInstanceKey);
  await journal({ event: "INSTANCE_CREATED", instance: row.processInstanceKey, scenario: name });
  return row;
}

async function testAll() {
  if ((await activeDemo()).length) throw new Error("An active demo already exists; finish it before automated tests. Nothing was cancelled.");
  const deployment = await deploymentMatches();
  const evidence = { startedAt: new Date().toISOString(), sourceSha256: deployment.sourceSha256, processDefinitionKey: deployedDemoKey, syntheticOnly: true, scenarios: [] };
  const owned = new Set(), completed = new Set(), adapter = adapterFor(owned);
  const history = createHistoryCollector({ api, journal });
  async function scenario(name, overrides) { const row = await create(name, overrides); owned.add(row.processInstanceKey); evidence.scenarios.push(row); console.log("START", name, row.processInstanceKey); return row; }
  async function waitTask(row, id) {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const found = (await tasks(row.processInstanceKey)).find(t => t.elementId === id && !completed.has(key(t.userTaskKey)));
      if (found) return found;
      row.steps.push(...await adapter.runOnce());
      await pause(300);
    }
    throw new Error("Task did not become ready: " + id);
  }
  async function complete(row, id, data) {
    const task = await waitTask(row, id), taskKey = key(task.userTaskKey);
    const form = await api(`/user-tasks/${taskKey}/form`, undefined, "GET");
    if (!form) throw new Error("Bound form missing");
    await api(`/user-tasks/${taskKey}/completion`, { action: "complete", variables: data });
    completed.add(taskKey);
    row.steps.push({ elementId: id, userTaskKey: taskKey, formRetrieved: true, submittedFieldNames: Object.keys(data) });
    await journal({ event: "USER_TASK_API_COMPLETED", instance: row.processInstanceKey, userTaskKey: taskKey, elementId: id,
      actor: "automated-test", delayReason: data.delayReason || "", clinicalCorrectionRequested: data.clinicalCorrectionRequested ?? null,
      reviewResponse: data.reviewResponse || "" });
  }
  async function draft(row) { await complete(row, "Draft", { clinicLetterId: row.clinicLetterId, letterType: "FOLLOW_UP",
    diagnosis: "Synthetic diagnosis", clinicalFindings: "Synthetic findings", treatmentDecisions: "Synthetic treatment decision",
    communicationInstructions: "Synthetic communication instructions", intendedRecipients: "PATIENT,GP",
    clinicalSummary: "Synthetic consultation summary", followUpPlan: "Synthetic follow-up arrangement", delayReason: "Synthetic test delay", reviewResponse: "Synthetic correction reviewed" }); }
  async function approve(row, yes) { await complete(row, "Approve", { clinicalApproved: yes, rejectionReason: yes ? "" : "Synthetic correction needed", delayReason: "" }); }
  async function admin(row, changes = {}) { await complete(row, "Admin", { recipientChecked: true, administrativeDetailsChecked: true,
    clinicalCorrectionRequested: false, clinicalCorrectionReason: "", delayReason: "", ...changes }); }
  async function finish(row) {
    const until = Date.now() + 18000;
    while (Date.now() < until) {
      row.steps.push(...await adapter.runOnce());
      const result = await state(row.processInstanceKey);
      if (key(result.processDefinitionKey) !== deployedDemoKey) throw new Error("Instance is not running the recorded deployment version");
      if (result.state === "COMPLETED") {
        const pending = await tasks(row.processInstanceKey);
        const incidents = await api("/incidents/search", { filter: { processInstanceKey: row.processInstanceKey, state: "ACTIVE" }, page: { limit: 100 } });
        if (pending.length || incidents.items.length) { await pause(300); continue; }
        row.end = result; row.metadata = await variables(row.processInstanceKey);
        for (const field of ["draftStartedAt", "draftCompletedAt", "approvedAt", "administrativeProcessedAt", "letterSentAt", "distributionMethod"]) {
          if (!row.metadata[field]) throw new Error("Missing lifecycle metadata " + field);
        }
        let completedRows = [];
        for (let attempt = 0; attempt < 12; attempt++) {
          completedRows = await tasks(row.processInstanceKey, "COMPLETED");
          if (["Draft", "Approve", "Admin"].every(id => completedRows.some(t => t.elementId === id))) break;
          await pause(300);
        }
        if (!["Draft", "Approve", "Admin"].every(id => completedRows.some(t => t.elementId === id))) throw new Error("User-task lifecycle evidence did not catch up");
        row.completedTasks = completedRows.map(t => ({ elementId: t.elementId,
          userTaskKey: key(t.userTaskKey), creationDate: t.creationDate, completionDate: t.completionDate, assignee: t.assignee }));
        await journal({ event: "INSTANCE_COMPLETED", instance: row.processInstanceKey, metadata: row.metadata, completedTasks: row.completedTasks });
        await history.capture([row.processInstanceKey]);
        row.status = "PASS"; console.log("PASS", row.name); return;
      }
      if (result.state !== "ACTIVE" || result.hasIncident) throw new Error("Unexpected terminal state or incident");
      await pause(350);
    }
    throw new Error("Instance did not complete");
  }
  try {
    const normal = await scenario("NORMAL"); await draft(normal); await approve(normal, true); await admin(normal); await finish(normal);
    const reject = await scenario("CLINICAL_REWORK"); await draft(reject); await approve(reject, false); await draft(reject); await approve(reject, true); await admin(reject); await finish(reject);
    for (const field of ["recipientChecked", "administrativeDetailsChecked"]) {
      const row = await scenario("ADMIN_" + field); await draft(row); await approve(row, true); await admin(row, { [field]: false }); await admin(row); await finish(row);
    }
    const concern = await scenario("SECRETARY_CLINICAL_CONCERN"); await draft(concern); await approve(concern, true);
    await admin(concern, { clinicalCorrectionRequested: true, clinicalCorrectionReason: "Synthetic suspected clinical issue" });
    await waitTask(concern, "Draft");
    if ((await variables(concern.processInstanceKey)).clinicalApproved !== false) throw new Error("Old approval not cleared on clinical return");
    concern.steps.push({ assertion: "Secretary clinical issue returns to doctor and clears prior approval" });
    await draft(concern); await approve(concern, true); await admin(concern); await finish(concern);
    const error = await scenario("BUSINESS_ERROR", { simulateDispatchError: true }); await draft(error); await approve(error, true); await admin(error);
    await complete(error, "Retry", { dispatchResolution: "Synthetic correction", retryAuthorised: false, simulateDispatchError: false, delayReason: "" });
    await complete(error, "Retry", { dispatchResolution: "Synthetic authorised correction", retryAuthorised: true, simulateDispatchError: false, delayReason: "" });
    await finish(error);
    const technical = await scenario("TECHNICAL_RETRY", { simulateTechnicalFailuresRemaining: 2 }); await draft(technical); await approve(technical, true); await admin(technical); await finish(technical);
    if (technical.steps.filter(s => s.technical && s.action === "fail").length !== 2) throw new Error("Expected exactly two technical failures before successful retry");
    const delayed = await scenario("DELAY"); await waitTask(delayed, "Draft");
    const until = Date.now() + 42000;
    const seen = new Set();
    while (Date.now() < until && seen.size < 3) {
      for (const type of [DEMO_JOB_TYPES.reminder, DEMO_JOB_TYPES.oneMonth, DEMO_JOB_TYPES.threeMonths]) {
        for (const job of await adapter.activate(type)) { delayed.steps.push(await adapter.processJob(job, type)); seen.add(type); }
      }
      if (seen.size < 3) await pause(350);
    }
    if (seen.size !== 3 || (await state(delayed.processInstanceKey)).state !== "ACTIVE") throw new Error("Delay milestones or continued clinical work not verified");
    await draft(delayed); await approve(delayed, true); await admin(delayed); await finish(delayed);
    await pause(11000);
    for (const type of Object.values(DEMO_JOB_TYPES)) {
      const leftovers = await adapter.activate(type);
      if (leftovers.length) throw new Error("Unexpected job after cancellation; not completed as part of this assertion");
    }
    evidence.cancellation = { waitMs: 11000, remainingJobs: 0 };
    evidence.status = "PASS";
  } catch (error) { evidence.status = "FAIL"; evidence.error = error.message; throw error; }
  finally { evidence.finishedAt = new Date().toISOString(); await save("personal-engine-" + Date.now() + ".json", evidence); await save("personal-engine-latest.json", evidence); }
  return evidence;
}

async function prepare() {
  await deploymentMatches();
  if ((await activeDemo()).length) throw new Error("Existing active demo found; finish it before preparing another");
  const row = await create("MANUAL"), adapter = adapterFor(new Set([row.processInstanceKey]));
  for (let i = 0; i < 20; i++) {
    if ((await tasks(row.processInstanceKey)).some(t => t.elementId === "Draft")) { console.log("READY", row.processInstanceKey, row.clinicLetterId); return row; }
    await adapter.runOnce(); await pause(300);
  }
  throw new Error("Draft not ready; inspect the recorded instance before repeating prepare");
}

async function worker(minutes) {
  await deploymentMatches();
  const saved = JSON.parse(await readFile(new URL("evidence/local-state.json", root), "utf8"));
  const owned = new Set(saved.instances.map(key));
  for (const active of await activeDemo()) if (!owned.has(key(active.processInstanceKey))) throw new Error("Unowned active demo exists; do not compete with another worker");
  const adapter = adapterFor(owned), end = Date.now() + minutes * 60000;
  const history = createHistoryCollector({ api, journal });
  let stop = false;
  const halt = () => { stop = true; };
  process.once("SIGINT", halt); process.once("SIGTERM", halt);
  try {
    console.log("WORKER_UNTIL", new Date(end).toISOString());
    while (!stop && Date.now() < end) {
      for (const result of await adapter.runOnce()) console.log(JSON.stringify(result));
      await history.capture([...owned]);
      await pause(1000);
    }
  } finally { process.removeListener("SIGINT", halt); process.removeListener("SIGTERM", halt); await journal({ event: "WORKER_STOP", reason: stop ? "signal" : "time_limit" }); }
}

export async function main(args) {
  const options = parseArgs(args); // No filesystem writes or network before explicit argument validation.
  const topology = await api("/topology", undefined, "GET");
  if (topology.gatewayVersion !== "8.9.21") throw new Error("This practice runner is verified only against local Camunda 8.9.21");
  await mkdir(new URL("evidence/", root), { recursive: true });
  const lockPath = new URL("evidence/.local-demo.lock", root);
  let lock;
  try { lock = await open(lockPath, "wx"); } catch (error) {
    if (error.code === "EEXIST") throw new Error("Another personal runner or a stale lock exists. Inspect it before retrying; no automatic process termination or lock deletion.");
    throw error;
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), command: options.command }));
  try {
    if (options.command === "deploy") return await deploy();
    if (options.command === "test") return await testAll();
    if (options.command === "prepare") return await prepare();
    return await worker(options.minutes);
  } finally { await lock.close(); await unlink(lockPath); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
