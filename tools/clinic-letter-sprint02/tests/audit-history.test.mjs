import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryCollector } from "../audit-history.mjs";

const instance = "2251799813685487", scope = "2251799813685505", taskKey = "2251799813685506";
const task = {
  processInstanceKey: instance, userTaskKey: taskKey, elementInstanceKey: scope,
  elementId: "Draft", state: "COMPLETED", assignee: null,
  creationDate: "2026-09-27T19:51:34.080Z", completionDate: "2026-09-27T19:51:35.399Z"
};
const page = items => ({ items, page: { totalItems: items.length, hasMoreTotalItems: false } });
const variable = (name, value, extra = {}) => ({ processInstanceKey: instance, scopeKey: scope,
  name, value: JSON.stringify(value), ...extra });

function fixture({ tasks = page([task]), variables = page([variable("delayReason", "Synthetic valid delay")]), journalError = false } = {}) {
  const calls = [], records = [];
  const api = async (path, body) => { calls.push({ path, body }); return path === "/user-tasks/search" ? tasks : variables; };
  const journal = async entry => { if (journalError) throw new Error("Journal unavailable"); records.push(entry); };
  const collector = createHistoryCollector({ api, journal });
  return { capture: collector.capture, calls, records };
}

test("history uses completed task-local scope and actual engine dates/nullable assignee", async () => {
  const f = fixture({ variables: page([
    variable("delayReason", "Synthetic valid delay"), variable("clinicalApproved", false),
    variable("clinicalSummary", "PRIVATE CLINICAL CONTENT"), variable("contactAddress", "PRIVATE ADDRESS"), variable("token", "PRIVATE TOKEN")
  ]) });
  assert.deepEqual(await f.capture(new Set([instance])), { recorded: 1 });
  assert.deepEqual(f.calls[0], { path: "/user-tasks/search", body: { filter: { processInstanceKey: instance, state: "COMPLETED" }, page: { limit: 100 } } });
  assert.deepEqual(f.calls[1], { path: "/variables/search", body: { filter: { processInstanceKey: instance, scopeKey: scope }, page: { limit: 100 } } });
  assert.equal(f.records[0].eventId, `task:${taskKey}`);
  assert.equal(f.records[0].assignee, null);
  assert.equal(f.records[0].creationDate, task.creationDate);
  assert.equal(f.records[0].completionDate, task.completionDate);
  assert.deepEqual(f.records[0].fields, { delayReason: "Synthetic valid delay", clinicalApproved: false });
  assert.match(f.records[0].authorizationNote, /not proof/);
  assert.ok(!JSON.stringify(f.records).includes("PRIVATE"));
});

test("all allowed reasons and booleans can be retained without invented identity", async () => {
  const f = fixture({ tasks: page([{ ...task, assignee: "demo" }]), variables: page([
    variable("rejectionReason", "Synthetic correction"), variable("clinicalCorrectionReason", "Synthetic suspected issue"),
    variable("reviewResponse", "Synthetic reviewed response"), variable("recipientChecked", true),
    variable("administrativeDetailsChecked", false), variable("clinicalCorrectionRequested", true)
  ]) });
  await f.capture([instance]);
  assert.equal(f.records[0].assignee, "demo");
  assert.equal(f.records[0].fields.reviewResponse, "Synthetic reviewed response");
  assert.equal(f.records[0].fields.clinicalCorrectionRequested, true);
});

test("repeated captures deduplicate successful events within the collector", async () => {
  const f = fixture();
  assert.deepEqual(await f.capture([instance, instance]), { recorded: 1 });
  assert.deepEqual(await f.capture([instance]), { recorded: 0 });
  assert.equal(f.records.length, 1);
  assert.equal(f.calls.filter(c => c.path === "/variables/search").length, 1);
});

test("partial or unknown task/variable pages fail closed, including uncapped next-page totals", async () => {
  for (const bad of [{ items: [], page: { totalItems: 101, hasMoreTotalItems: false } },
    { items: [], page: { totalItems: 0, hasMoreTotalItems: true } }, { items: [] }, { items: {}, page: {} }]) {
    const taskFixture = fixture({ tasks: bad });
    await assert.rejects(taskFixture.capture([instance]), /incomplete or unknown/);
    assert.equal(taskFixture.records.length, 0);
    const variableFixture = fixture({ variables: bad });
    await assert.rejects(variableFixture.capture([instance]), /incomplete or unknown/);
    assert.equal(variableFixture.records.length, 0);
  }
});

test("unsafe or invalid scope keys are rejected before queries and history writes", async () => {
  for (const invalid of [9007199254740992, "1/../../other", "0", null, "9223372036854775808"]) {
    const f = fixture();
    await assert.rejects(f.capture([instance, invalid]), /key/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.records.length, 0);
  }
  const foreign = fixture({ tasks: page([{ ...task, processInstanceKey: "42" }]) });
  await assert.rejects(foreign.capture([instance]), /outside/);
  assert.equal(foreign.records.length, 0);
  const wrongScope = fixture({ variables: page([variable("delayReason", "Synthetic reason", { scopeKey: "42" })]) });
  await assert.rejects(wrongScope.capture([instance]), /unknown scope/);
  assert.equal(wrongScope.records.length, 0);
});

test("missing dates, malformed JSON, truncated values and incorrect decision types are not silently recorded", async () => {
  const missingDate = fixture({ tasks: page([{ ...task, completionDate: null }]) });
  await assert.rejects(missingDate.capture([instance]), /completionDate/);
  for (const row of [variable("delayReason", "Synthetic", { value: "not JSON" }),
    variable("delayReason", "Synthetic", { isTruncated: true }), variable("clinicalApproved", "true"),
    variable("reviewResponse", { clinicalSummary: "PRIVATE" })]) {
    const f = fixture({ variables: page([row]) });
    await assert.rejects(f.capture([instance]));
    assert.equal(f.records.length, 0);
  }
});

test("failed journal writes propagate and do not mark an event as successfully captured", async () => {
  let writes = 0;
  const records = [];
  const { capture } = createHistoryCollector({
    api: async path => path === "/user-tasks/search" ? page([task]) : page([]),
    journal: async record => { if (++writes === 1) throw new Error("Journal unavailable"); records.push(record); }
  });
  await assert.rejects(capture([instance]), /Journal unavailable/);
  assert.deepEqual(await capture([instance]), { recorded: 1 });
  assert.equal(records.length, 1);
});

test("invalid collector dependencies or key containers are refused", async () => {
  assert.throws(() => createHistoryCollector(), /functions/);
  const f = fixture();
  await assert.rejects(f.capture(instance), /array or Set/);
  assert.equal(f.calls.length, 0);
});
