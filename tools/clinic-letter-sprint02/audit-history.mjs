// Read-only collection of completed task metadata. The caller supplies owned demo
// instance keys and a journal; neither assignee metadata nor form values prove RBAC.
const TEXT_FIELDS = new Set(["delayReason", "rejectionReason", "clinicalCorrectionReason", "reviewResponse"]);
const BOOL_FIELDS = new Set(["clinicalApproved", "recipientChecked", "administrativeDetailsChecked", "clinicalCorrectionRequested"]);

function engineKey(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsafe numeric engine key");
  if (!/^[1-9][0-9]*$/.test(String(value)) || BigInt(value) > 9223372036854775807n) throw new Error("Invalid engine key");
  return String(value);
}

function completePage(result, label) {
  if (!result || !Array.isArray(result.items) || result.items.length > 100
    || !result.page || result.page.hasMoreTotalItems !== false
    || !Number.isSafeInteger(result.page.totalItems) || result.page.totalItems !== result.items.length) {
    throw new Error(`${label}: incomplete or unknown search result; no complete history claim`);
  }
  return result.items;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Missing valid engine ${label}; no complete history claim`);
  }
  return value;
}

function taskRecord(task, instance) {
  if (!task || task.state !== "COMPLETED" || engineKey(task.processInstanceKey) !== instance) {
    throw new Error("Completed task is outside the requested instance or state");
  }
  const creationDate = timestamp(task.creationDate, "creationDate");
  const completionDate = timestamp(task.completionDate, "completionDate");
  if (Date.parse(completionDate) < Date.parse(creationDate)) throw new Error("Engine task dates are out of order");
  if (typeof task.elementId !== "string" || !task.elementId || task.elementId.length > 200
    || !(task.assignee === null || (typeof task.assignee === "string" && task.assignee.length <= 512))) {
    throw new Error("Missing valid task element or assignee metadata");
  }
  return {
    event: "USER_TASK_HISTORY", eventId: `task:${engineKey(task.userTaskKey)}`,
    processInstanceKey: instance, userTaskKey: engineKey(task.userTaskKey),
    elementInstanceKey: engineKey(task.elementInstanceKey), elementId: task.elementId,
    creationDate, completionDate, assignee: task.assignee,
    source: "CAMUNDA_COMPLETED_USER_TASK_API",
    authorizationNote: "Assignee is engine metadata, not proof of role permissions or RBAC."
  };
}

function safeFields(rows, instance, scope) {
  const fields = {};
  for (const row of rows) {
    if (!row || typeof row.name !== "string") throw new Error("Malformed variable result");
    if (!TEXT_FIELDS.has(row.name) && !BOOL_FIELDS.has(row.name)) continue;
    if (engineKey(row.processInstanceKey) !== instance || engineKey(row.scopeKey) !== scope
      || row.isTruncated === true || row.truncated === true || typeof row.value !== "string"
      || Object.hasOwn(fields, row.name)) {
      throw new Error("Allowed history field has unknown scope or incomplete data");
    }
    let value;
    try { value = JSON.parse(row.value); } catch { throw new Error("Invalid JSON history field"); }
    if (TEXT_FIELDS.has(row.name)) {
      if (!(value === null || (typeof value === "string" && value.length <= 2000))) throw new Error("Invalid history reason or response");
    } else if (!(value === null || typeof value === "boolean")) throw new Error("Invalid history decision value");
    fields[row.name] = value;
  }
  return fields;
}

export function createHistoryCollector({ api, journal } = {}) {
  if (typeof api !== "function" || typeof journal !== "function") throw new TypeError("api and journal functions are required");
  const seen = new Set();
  async function capture(instanceKeys) {
    if (!(Array.isArray(instanceKeys) || instanceKeys instanceof Set)) throw new TypeError("Owned instance keys must be an array or Set");
    // Validate the full requested scope before any API calls or journal writes.
    const instances = [...new Set([...instanceKeys].map(engineKey))];
    let recorded = 0;
    for (const instance of instances) {
      const tasks = completePage(await api("/user-tasks/search", {
        filter: { processInstanceKey: instance, state: "COMPLETED" }, page: { limit: 100 }
      }), "User tasks");
      for (const task of tasks) {
        const record = taskRecord(task, instance);
        if (seen.has(record.eventId)) continue;
        const variables = completePage(await api("/variables/search", {
          filter: { processInstanceKey: instance, scopeKey: record.elementInstanceKey }, page: { limit: 100 }
        }), "Task-local variables");
        record.fields = safeFields(variables, instance, record.elementInstanceKey);
        await journal(record);
        seen.add(record.eventId); // A failed journal write remains retryable.
        recorded++;
      }
    }
    return { recorded };
  }
  return Object.freeze({ capture });
}
