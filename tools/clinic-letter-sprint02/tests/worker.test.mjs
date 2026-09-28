import test from "node:test";
import assert from "node:assert/strict";
import { JOB_TYPES, DEMO_JOB_TYPES, CLINICAL_FIELDS, handleJob, runDemo } from "../worker.mjs";

const approved = { clinicLetterId: "X1", clinicalApproved: true, recipientChecked: true, administrativeDetailsChecked: true,
 clinicalCorrectionRequested: false, letterType: "NEW_PATIENT", clinicalSummary: "Demo consultation", diagnosis: "Demo diagnosis",
 clinicalFindings: "Demo findings", treatmentDecisions: "Demo decisions", followUpPlan: "Demo follow-up",
 communicationInstructions: "Demo instructions", intendedRecipients: "PATIENT,GP" };
const fixed = new Date("2026-01-01T00:00:00Z");

test("dispatch is simulated, uses isolated job type and stable retry reference", () => {
  const result = handleJob(JOB_TYPES.dispatch, approved, fixed);
  assert.equal(JOB_TYPES.dispatch, "clinic-letter.sprint02.dispatch");
  assert.equal(result.action, "complete");
  assert.equal(result.variables.dispatchStatus, "SIMULATED_SENT");
  assert.equal(result.variables.letterSentAt, fixed.toISOString());
  assert.equal(result.variables.distributionMethod, "SIMULATED_LOCAL");
  assert.equal(result.variables.dispatchReference, handleJob(JOB_TYPES.dispatch, approved).variables.dispatchReference);
  assert.equal(result.safe.simulated, true);
});

test("dispatch refuses missing, false or string clinical/admin checks", () => {
  for (const key of ["clinicalApproved", "recipientChecked", "administrativeDetailsChecked"]) {
    for (const value of [undefined, false, "true", 1]) {
      const result = handleJob(JOB_TYPES.dispatch, { ...approved, [key]: value });
      assert.equal(result.action, "throwBpmnError");
      assert.equal(result.errorCode, "CLINIC_LETTER_DISPATCH_REJECTED");
      assert.equal(result.variables, undefined);
    }
  }
});

test("dispatch simulation flag is a strict boolean", () => {
  assert.equal(handleJob(JOB_TYPES.dispatch, { ...approved, simulateDispatchError: true }).action, "throwBpmnError");
  assert.equal(handleJob(JOB_TYPES.dispatch, { ...approved, simulateDispatchError: false }).action, "complete");
  for (const value of ["false", "true", 1, null]) {
    assert.throws(() => handleJob(JOB_TYPES.dispatch, { ...approved, simulateDispatchError: value }), /must be a boolean/);
  }
});

test("notifications do not pretend managerial actions or clinical approval", () => {
  for (const type of [JOB_TYPES.reminder, JOB_TYPES.oneMonth, JOB_TYPES.threeMonths]) {
    const result = handleJob(type, { clinicLetterId: "X1" }, fixed);
    assert.equal(result.action, "complete");
    assert.ok(Object.values(result.variables).includes("SIMULATED_AUTOMATED_NOTIFICATION"));
    assert.equal(result.variables.clinicalApproved, undefined);
  }
});

test("invalid identifiers, inputs and unrelated service types are rejected", () => {
  for (const value of [undefined, "", "patient@example.org", {}, "x".repeat(81)]) {
    assert.throws(() => handleJob(JOB_TYPES.dispatch, { ...approved, clinicLetterId: value }), /clinicLetterId/);
  }
  assert.throws(() => handleJob(JOB_TYPES.dispatch, null), /Variables/);
  assert.throws(() => handleJob("correspondence.dispatch", approved), /Unsupported/);
});

test("offline demo covers five isolated job types without patient data", () => {
  const result = runDemo();
  assert.equal(result.length, 5);
  assert.ok(result.every(item => item.result.action === "complete" && item.result.safe.simulated));
  assert.ok(!JSON.stringify(result).includes("@"));
  assert.deepEqual(result.map(item => item.type), Object.values(DEMO_JOB_TYPES));
});

test("every new drafting stage clears prior approval and records worker time",()=>{
 const input={...approved,draftStartedAt:"client-forged",draftCompletedAt:"old",approvedAt:"old",administrativeProcessedAt:"old"};
 const result=handleJob(DEMO_JOB_TYPES.draftStart,input,fixed);
 assert.equal(result.variables.draftStartedAt,fixed.toISOString());
 for(const key of ["clinicalApproved","clinicalCorrectionRequested","recipientChecked","administrativeDetailsChecked"])assert.equal(result.variables[key],false);
 for(const key of ["draftCompletedAt","approvedAt","administrativeProcessedAt"])assert.equal(result.variables[key],null);
 assert.equal(result.variables.clinicalSummary,undefined);
 assert.equal(input.clinicalApproved,true);
});

test("dispatch refuses outstanding clinical correction even after old approval",()=>{
 assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,{...approved,clinicalCorrectionRequested:true},fixed).action,"throwBpmnError");
 for(const value of [null,"false",1])assert.throws(()=>handleJob(DEMO_JOB_TYPES.dispatch,{...approved,clinicalCorrectionRequested:value}),/boolean/);
});

test("dispatch requires structured consultation content and valid letter type",()=>{
 for(const key of CLINICAL_FIELDS)for(const value of [undefined,"", "  ", null, 1, "x".repeat(2001)]){
  const result=handleJob(DEMO_JOB_TYPES.dispatch,{...approved,[key]:value},fixed);
  assert.equal(result.action,"throwBpmnError",key);
  assert.equal(result.variables,undefined);
 }
 for(const value of [undefined,"invalid","new_patient",null])assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,{...approved,letterType:value},fixed).action,"throwBpmnError");
 assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,{...approved,letterType:"FOLLOW_UP"},fixed).action,"complete");
});

test("dispatch accepts only distinct consultant-selected recipient role codes",()=>{
 for(const value of [undefined,"", "patient@example.org","PATIENT,PATIENT","Patient,GP","PATIENT,",["PATIENT"]]){
  assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,{...approved,intendedRecipients:value},fixed).action,"throwBpmnError");
 }
 assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,{...approved,intendedRecipients:"PATIENT, GP, HEALTHCARE_PROVIDER, OTHER_PROFESSIONAL"},fixed).action,"complete");
});

test("bounded transient technical failures are separate from BPMN business rejection",()=>{
 let vars={...approved,simulateTechnicalFailuresRemaining:2};
 for(const remaining of [1,0]){
  const result=handleJob(DEMO_JOB_TYPES.dispatch,vars,fixed);
  assert.equal(result.action,"fail");
  assert.equal(result.variables.simulateTechnicalFailuresRemaining,remaining);
  assert.equal(result.retryBackOff,1000);
  assert.equal(result.errorCode,undefined);
  assert.equal(result.variables.dispatchStatus,undefined);
  vars={...vars,...result.variables};
 }
 assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,vars,fixed).variables.dispatchStatus,"SIMULATED_SENT");
 for(const value of [-1,3,1.5,"1",null])assert.throws(()=>handleJob(DEMO_JOB_TYPES.dispatch,{...approved,simulateTechnicalFailuresRemaining:value}),/integer from 0 to 2/);
 assert.equal(handleJob(DEMO_JOB_TYPES.dispatch,{...approved,simulateTechnicalFailuresRemaining:2,simulateDispatchError:true},fixed).action,"throwBpmnError");
});

test("already approved letters suppress repeated consultant reminders; rework restores them",()=>{
 const suppressed=handleJob(DEMO_JOB_TYPES.reminder,approved,fixed);
 assert.equal(suppressed.variables.reminderStatus,"SUPPRESSED_ALREADY_APPROVED");
 assert.equal(suppressed.variables.lastReminderAt,undefined);
 const correction=handleJob(DEMO_JOB_TYPES.reminder,{...approved,clinicalCorrectionRequested:true},fixed);
 assert.equal(correction.variables.reminderStatus,"SIMULATED_AUTOMATED_NOTIFICATION");
 const reset=handleJob(DEMO_JOB_TYPES.draftStart,approved,fixed).variables;
 const reminder=handleJob(DEMO_JOB_TYPES.reminder,{...approved,...reset},fixed);
 assert.equal(reminder.variables.reminderStatus,"SIMULATED_AUTOMATED_NOTIFICATION");
});

test("delay reasons are optional bounded demo text and do not leak in safe output",()=>{
 for(const delayReason of ["","Demo: awaiting review"]){
  const result=handleJob(DEMO_JOB_TYPES.reminder,{clinicLetterId:"X1",delayReason},fixed);
  assert.equal(result.action,"complete");
  assert.equal(result.safe.delayReason,undefined);
 }
 for(const delayReason of [null,1,"x".repeat(501)])assert.throws(()=>handleJob(DEMO_JOB_TYPES.reminder,{clinicLetterId:"X1",delayReason},fixed),/delayReason/);
});

test("worker outputs neither clinical content nor patient addresses",()=>{
 for(const type of Object.values(DEMO_JOB_TYPES)){
  const result=handleJob(type,approved,fixed);
  const output=JSON.stringify(result);
  for(const key of CLINICAL_FIELDS)assert.ok(!output.includes(approved[key]),key);
  assert.ok(!output.includes(approved.intendedRecipients));
 }
});

test("exact normal and demo task types share guards without accepting arbitrary prefixes", () => {
  assert.equal(DEMO_JOB_TYPES.dispatch, "clinic-letter.sprint02-demo.dispatch");
  for (const key of Object.keys(JOB_TYPES)) {
    assert.deepEqual(handleJob(JOB_TYPES[key], approved, fixed), handleJob(DEMO_JOB_TYPES[key], approved, fixed));
  }
  assert.equal(handleJob(DEMO_JOB_TYPES.dispatch, { ...approved, clinicalApproved: false }).action, "throwBpmnError");
  assert.throws(() => handleJob("clinic-letter.sprint02-other.dispatch", approved), /Unsupported/);
});
