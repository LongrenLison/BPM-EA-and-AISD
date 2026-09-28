import { pathToFileURL } from "node:url";

export const JOB_TYPES = Object.freeze({
  draftStart: "clinic-letter.sprint02.record-draft-start",
  dispatch: "clinic-letter.sprint02.dispatch",
  reminder: "clinic-letter.sprint02.reminder",
  oneMonth: "clinic-letter.sprint02.escalate-one-month",
  threeMonths: "clinic-letter.sprint02.escalate-three-months"
});

export const LETTER_TYPES = Object.freeze(["NEW_PATIENT", "FOLLOW_UP"]);
export const RECIPIENT_CODES = Object.freeze(["PATIENT", "GP", "HEALTHCARE_PROVIDER", "OTHER_PROFESSIONAL"]);
export const CLINICAL_FIELDS = Object.freeze(["clinicalSummary", "diagnosis", "clinicalFindings",
  "treatmentDecisions", "followUpPlan", "communicationInstructions"]);

function validDemoText(value, max = 2000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function rejected(safe, message) {
  return { action: "throwBpmnError", errorCode: "CLINIC_LETTER_DISPATCH_REJECTED", errorMessage: message, safe };
}

export const DEMO_JOB_TYPES = Object.freeze(Object.fromEntries(
  Object.entries(JOB_TYPES).map(([key, type]) => [key, type.replace("clinic-letter.sprint02.", "clinic-letter.sprint02-demo.")])
));

export function handleJob(type, variables = {}, now = new Date()) {
  const entry = Object.keys(JOB_TYPES).find(key => JOB_TYPES[key] === type || DEMO_JOB_TYPES[key] === type);
  if (!entry) throw new Error(`Unsupported job type: ${type}`);
  const normalType = JOB_TYPES[entry];
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) throw new TypeError("Variables must be an object");
  if (typeof variables.clinicLetterId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(variables.clinicLetterId)) {
    throw new TypeError("A non-patient clinicLetterId identifier (letters, digits, underscore or hyphen) is required");
  }
  if (variables.simulateDispatchError !== undefined && typeof variables.simulateDispatchError !== "boolean") {
    throw new TypeError("simulateDispatchError must be a boolean");
  }
  if (variables.clinicalCorrectionRequested !== undefined && typeof variables.clinicalCorrectionRequested !== "boolean") {
    throw new TypeError("clinicalCorrectionRequested must be a boolean");
  }
  if (variables.simulateTechnicalFailuresRemaining !== undefined
    && (!Number.isInteger(variables.simulateTechnicalFailuresRemaining)
      || variables.simulateTechnicalFailuresRemaining < 0 || variables.simulateTechnicalFailuresRemaining > 2)) {
    throw new TypeError("simulateTechnicalFailuresRemaining must be an integer from 0 to 2");
  }
  if (variables.delayReason !== undefined && (typeof variables.delayReason !== "string" || variables.delayReason.length > 500)) {
    throw new TypeError("delayReason must be optional demo text within 500 characters");
  }
  const safe = { clinicLetterId: variables.clinicLetterId, at: now.toISOString(), simulated: true };
  if (normalType === JOB_TYPES.draftStart) {
    // Entry into drafting, not proof of the clinician's first keyboard action.
    // Reset previous approval on every rework route; time comes from the worker, not a task form.
    return { action: "complete", variables: {
      draftStartedAt: safe.at, draftCompletedAt: null, approvedAt: null, administrativeProcessedAt: null,
      clinicalApproved: false, recipientChecked: false, administrativeDetailsChecked: false,
      clinicalCorrectionRequested: false
    }, safe };
  }
  if (normalType === JOB_TYPES.dispatch) {
    // Workflow booleans do not replace engine identity/role authorization.
    if (variables.clinicalApproved !== true || variables.recipientChecked !== true || variables.administrativeDetailsChecked !== true
      || variables.clinicalCorrectionRequested === true) {
      return rejected(safe, "Clinical approval, no outstanding clinical correction, and both administrative checks are required");
    }
    if (!LETTER_TYPES.includes(variables.letterType) || CLINICAL_FIELDS.some(key => !validDemoText(variables[key]))) {
      return rejected(safe, "Required structured demo letter content or letter type is incomplete");
    }
    if (typeof variables.intendedRecipients !== "string") return rejected(safe, "Consultant-selected demo recipient roles are required");
    const recipients = variables.intendedRecipients.split(",").map(value => value.trim());
    if (new Set(recipients).size !== recipients.length || recipients.some(value => !RECIPIENT_CODES.includes(value))) {
      return rejected(safe, "Only distinct consultant-selected demo recipient role codes are allowed; never real addresses");
    }
    if (variables.simulateDispatchError === true) return rejected(safe, "Simulated dispatch business rejection");
    const remaining = variables.simulateTechnicalFailuresRemaining ?? 0;
    if (remaining > 0) {
      // Technical retry uses /jobs/failure; never convert it to a BPMN business rejection.
      return { action: "fail", variables: { simulateTechnicalFailuresRemaining: remaining - 1 },
        retryBackOff: 1000, errorMessage: "Simulated transient Clinic Letter transport failure", safe };
    }
    // Stable across retries; this is not real delivery or durable external idempotency.
    return { action: "complete", variables: { dispatchStatus: "SIMULATED_SENT", dispatchReference: `demo-${safe.clinicLetterId}`,
      letterSentAt: safe.at, distributionMethod: "SIMULATED_LOCAL" }, safe };
  }
  if (normalType === JOB_TYPES.reminder && variables.clinicalApproved === true && variables.clinicalCorrectionRequested !== true) {
    return { action: "complete", variables: { reminderStatus: "SUPPRESSED_ALREADY_APPROVED" }, safe };
  }
  if (normalType === JOB_TYPES.reminder) return { action: "complete", variables: { lastReminderAt: safe.at, reminderStatus: "SIMULATED_AUTOMATED_NOTIFICATION" }, safe };
  if (normalType === JOB_TYPES.oneMonth) return { action: "complete", variables: { oneMonthEscalatedAt: safe.at, oneMonthNotificationStatus: "SIMULATED_AUTOMATED_NOTIFICATION" }, safe };
  return { action: "complete", variables: { threeMonthEscalatedAt: safe.at, threeMonthNotificationStatus: "SIMULATED_AUTOMATED_NOTIFICATION" }, safe };
}

export function runDemo() {
  const now = new Date("2026-09-28T09:00:00.000Z");
  const variables = { clinicLetterId: "DEMO-001", clinicalApproved: true, recipientChecked: true, administrativeDetailsChecked: true,
    clinicalCorrectionRequested: false, letterType: "NEW_PATIENT", clinicalSummary: "Demo consultation", diagnosis: "Demo diagnosis",
    clinicalFindings: "Demo findings", treatmentDecisions: "Demo decisions", followUpPlan: "Demo follow-up",
    communicationInstructions: "Demo instructions", intendedRecipients: "PATIENT,GP" };
  return Object.values(DEMO_JOB_TYPES).map(type => ({ type, result: handleJob(type, variables, now) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv.includes("--demo")) {
    console.error("Safety stop: this standalone worker only runs with --demo and never connects or sends email.");
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(runDemo(), null, 2));
  }
}
