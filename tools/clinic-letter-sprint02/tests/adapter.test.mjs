import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLocalAdapter, PROCESS_IDS } from "../adapter.mjs";
import { JOB_TYPES, DEMO_JOB_TYPES } from "../worker.mjs";

const inputs = { clinicLetterId: "DEMO-001", consultationCompletedAt: "2026-01-01T00:00:00Z", clinicalApproved: true,
  recipientChecked: true, administrativeDetailsChecked: true, clinicalCorrectionRequested: false,
  letterType: "FOLLOW_UP", diagnosis: "Synthetic diagnosis", clinicalFindings: "Synthetic findings",
  clinicalSummary: "Synthetic summary", followUpPlan: "Synthetic follow-up plan",
  treatmentDecisions: "Synthetic treatment decision", communicationInstructions: "Synthetic instructions", intendedRecipients: "PATIENT,GP" };
const job = { jobKey: "22517998136899999", type: DEMO_JOB_TYPES.dispatch, processDefinitionId: PROCESS_IDS[1], variables: inputs };
function mocked(responses = [], options = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    const response = responses.shift() ?? { status: 204 };
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
  };
  return { requests, adapter: createLocalAdapter({ enabled: true, fetchImpl, now: () => new Date("2026-01-01T00:00:00Z"), ...options }) };
}

test("adapter stays disabled unless explicitly enabled and rejects external/credential endpoints", () => {
  assert.throws(() => createLocalAdapter(), /disabled/);
  assert.throws(() => createLocalAdapter({ enabled: "true" }), /disabled/);
  for (const baseUrl of ["https://example.org/v2", "http://user:password@localhost:8080/v2", "http://localhost:8080/v2?q=1", "http://localhost:8080/v2#x", "http://localhost:8080/not-v2", "file:///v2"]) {
    assert.throws(() => createLocalAdapter({ enabled: true, baseUrl }), /loopback/);
  }
  assert.throws(() => createLocalAdapter({ enabled: true, processDefinitionId: "old-process" }), /process id/);
});

test("activation requests only isolated job types and minimal guard variables", async () => {
  const { adapter, requests } = mocked([{ status: 200, body: { jobs: [job] } }]);
  assert.deepEqual(await adapter.activate(DEMO_JOB_TYPES.dispatch), [job]);
  assert.equal(requests[0].url, "http://localhost:8080/v2/jobs/activation");
  assert.equal(requests[0].body.maxJobsToActivate, 1);
  assert.equal(requests[0].body.requestTimeout, -1);
  assert.equal(requests[0].redirect, "error");
  assert.equal(requests[0].credentials, "omit");
  assert.equal(requests[0].headers.Accept, "application/json");
  assert.ok(!requests[0].body.fetchVariable.includes("letterText"));
  await assert.rejects(adapter.activate("correspondence.dispatch"), /Unsupported/);
  assert.equal(requests.length, 1);
});

test("approved job completes with string key intact and no real delivery claim", async () => {
  const { adapter, requests } = mocked();
  const result = await adapter.processJob(job);
  assert.equal(result.action, "complete");
  assert.equal(requests[0].url, `http://localhost:8080/v2/jobs/${job.jobKey}/completion`);
  assert.equal(requests[0].body.variables.dispatchStatus, "SIMULATED_SENT");
});

test("guard denial and simulated rejection use BPMN business-error endpoint", async () => {
  for (const variables of [{ ...inputs, clinicalApproved: false }, { ...inputs, simulateDispatchError: true }]) {
    const { adapter, requests } = mocked();
    assert.equal((await adapter.processJob({ ...job, variables })).action, "throwBpmnError");
    assert.ok(requests[0].url.endsWith("/error"));
    assert.equal(requests[0].body.errorCode, "CLINIC_LETTER_DISPATCH_REJECTED");
  }
});

test("malformed worker input fails to incident without patient content or retry loops", async () => {
  const { adapter, requests } = mocked();
  const result = await adapter.processJob({ ...job, variables: { ...inputs, simulateDispatchError: "false", letterText: "PRIVATE" } });
  assert.equal(result.action, "fail");
  assert.ok(requests[0].url.endsWith("/failure"));
  assert.equal(requests[0].body.retries, 0);
  assert.ok(!JSON.stringify(requests[0].body).includes("PRIVATE"));
});

test("foreign process/type and unsafe keys cause no write", async () => {
  const { adapter, requests } = mocked();
  await assert.rejects(adapter.processJob({ ...job, processDefinitionId: "other" }), /outside/);
  await assert.rejects(adapter.processJob({ ...job, type: "correspondence.dispatch" }), /outside/);
  await assert.rejects(adapter.processJob({ ...job, type: DEMO_JOB_TYPES.reminder }, DEMO_JOB_TYPES.dispatch), /outside/);
  for (const jobKey of [9007199254740992, "1/../../other", "0", null, "9223372036854775808"]) await assert.rejects(adapter.processJob({ ...job, jobKey }), /key/);
  assert.equal(requests.length, 0);
});

test("uncertain HTTP completion outcome is reported without a second mutation", async () => {
  const { adapter, requests } = mocked([{ status: 503 }]);
  await assert.rejects(adapter.processJob(job), /HTTP 503/);
  assert.equal(requests.length, 1);
});

test("bounded single cycle activates at most one job per isolated type", async () => {
  const responses = Object.values(DEMO_JOB_TYPES).flatMap(type => [
    { status: 200, body: { jobs: [{ ...job, type }] } }, { status: 204 }
  ]);
  const { adapter, requests } = mocked(responses);
  assert.equal((await adapter.runOnce()).length, Object.values(DEMO_JOB_TYPES).length);
  assert.equal(requests.length, Object.values(DEMO_JOB_TYPES).length * 2);
});

test("invalid activation payload is not treated as successful empty polling", async () => {
  for (const body of [{}, { jobs: [job, job] }]) {
    const { adapter } = mocked([{ status: 200, body }]);
    await assert.rejects(adapter.activate(DEMO_JOB_TYPES.dispatch), /activation response/);
  }
});

test("normal and demo adapters reject each other's types before any activation request", async () => {
  const demo = mocked([{ status: 200, body: { jobs: [] } }]);
  await assert.rejects(demo.adapter.activate(JOB_TYPES.dispatch), /Unsupported/);
  assert.equal(demo.requests.length, 0);
  await demo.adapter.activate(DEMO_JOB_TYPES.dispatch);
  assert.equal(demo.requests[0].body.type, DEMO_JOB_TYPES.dispatch);

  const normal = mocked([{ status: 200, body: { jobs: [] } }], { processDefinitionId: PROCESS_IDS[0] });
  await assert.rejects(normal.adapter.activate(DEMO_JOB_TYPES.dispatch), /Unsupported/);
  assert.equal(normal.requests.length, 0);
  await normal.adapter.activate(JOB_TYPES.dispatch);
  assert.equal(normal.requests[0].body.type, JOB_TYPES.dispatch);
});

test("normal CLI invocation refuses without opt-in and performs no adapter run", () => {
  const file = fileURLToPath(new URL("../adapter.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Safety stop: adapter is off/);
  assert.equal(result.stdout, "");
});

test("technical failure decrements actual retry count and uses failure variables rather than business error", async () => {
  const { adapter, requests } = mocked();
  const result = await adapter.processJob({ ...job, retries: 3, variables: { ...inputs, simulateTechnicalFailuresRemaining: 2 } });
  assert.equal(result.action, "fail");
  assert.equal(result.technical, true);
  assert.equal(result.retriesLeft, 2);
  assert.ok(requests[0].url.endsWith("/failure"));
  assert.equal(requests[0].body.retryBackOff, 1000);
  assert.equal(requests[0].body.variables.simulateTechnicalFailuresRemaining, 1);
  const invalid = mocked();
  await assert.rejects(invalid.adapter.processJob({ ...job, variables: { ...inputs, simulateTechnicalFailuresRemaining: 1 } }), /retry count/);
  assert.equal(invalid.requests.length, 0);
});

test("audit distinguishes confirmed writes from an uncertain HTTP result without logging clinical narrative", async () => {
  const records = [];
  const success = mocked([], { auditHook: async record => records.push(record) });
  await success.adapter.processJob(job);
  assert.deepEqual(records.map(r => r.phase), ["INTENT", "ACK"]);
  assert.ok(!JSON.stringify(records).includes("Synthetic diagnosis"));
  records.length = 0;
  const uncertain = mocked([{ status: 503 }], { auditHook: async record => records.push(record) });
  await assert.rejects(uncertain.adapter.processJob(job), /HTTP 503/);
  assert.deepEqual(records.map(r => r.phase), ["INTENT", "UNKNOWN"]);
  assert.equal(uncertain.requests.length, 1);
});
