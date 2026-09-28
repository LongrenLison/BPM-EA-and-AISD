import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL("../", import.meta.url);
const xml = await readFile(new URL("clinic-letter-sprint02.bpmn", base), "utf8");
const demo = await readFile(new URL("clinic-letter-sprint02-demo.bpmn", base), "utf8");
const original = await readFile(new URL("original-clinic-letter.bpmn", base), "utf8");
let restored = null;
try { restored = await readFile(new URL("../../../bpmn/clinic_letter_delay_escalation.bpmn", import.meta.url), "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const attrs = text => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1],m[2]]));
const flows = [...xml.matchAll(/<bpmn:sequenceFlow\b([^>]*)>([\s\S]*?)<\/bpmn:sequenceFlow>/g)].map(m=>({...attrs(m[1]),body:m[2]}));
const nodes = [...xml.matchAll(/<bpmn:(startEvent|endEvent|userTask|serviceTask|parallelGateway|exclusiveGateway|intermediateCatchEvent|boundaryEvent)\b([^>]*)>([\s\S]*?)<\/bpmn:\1>/g)].map(m=>({...attrs(m[2]),type:m[1],body:m[3]}));
const ids = new Set(nodes.map(n=>n.id));
test("original source is preserved unchanged, failed draft is separate", async()=>{
 const normalized = original.replace(/\r\n/g,"\n").trim();
 assert.equal(createHash("sha256").update(normalized).digest("hex"), "562e8d9385772719c1b9c577f33ad09c366a8a79d8d8442295e2dafb1aff4398");
 // The release ZIP is standalone; also compare the live repository when present.
 if (restored !== null) assert.equal(normalized,restored.replace(/\r\n/g,"\n").trim());
 assert.match(original,/isExecutable="false"/);
 assert.match(await readFile(new URL("previous-failed-draft.bpmn",base),"utf8"),/Process_ClinicLetterSprint02/);
});
for (const [name,source] of [["production",xml],["demo",demo]]) {
 test(name+": globally unique IDs and complete diagram",()=>{
  const all=[...source.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(all).size,all.length);
  assert.match(source,/<bpmndi:BPMNDiagram/);
  for(const n of nodes) assert.match(source,new RegExp('bpmnElement="'+n.id+'"'));
  for(const f of flows) assert.match(source,new RegExp('bpmnElement="'+f.id+'"'));
 });
}
test("all flow endpoints resolve and start split launches four branches",()=>{
 for(const f of flows){assert.ok(ids.has(f.sourceRef));assert.ok(ids.has(f.targetRef));}
 assert.equal(flows.filter(f=>f.sourceRef==="Split").length,4);
 assert.equal(flows.filter(f=>f.sourceRef==="Start").length,1);
});
test("Camunda user tasks have engine implementation, bound forms and scoped outputs", async()=>{
 for(const n of nodes.filter(n=>n.type==="userTask")){
  assert.match(n.body,/<zeebe:userTask\s*\/>/);
  assert.match(n.body,/bindingType="deployment"/);
  const id=n.body.match(/formId="([^"]+)"/)[1];
  const form=JSON.parse(await readFile(new URL("forms/"+id+".form",base),"utf8"));
  assert.equal(form.id,id);
  const fields=new Set(form.components.filter(c=>c.key).map(c=>c.key));
  const computed = {
   Draft: { clinicalApproved: "false", draftCompletedAt: "string(now())" },
   Approve: { approvedAt: "if clinicalApproved = true then string(now()) else null" },
   Admin: { clinicalCorrectionRequested: "if clinicalCorrectionRequested = true then true else false",
    administrativeProcessedAt: "if recipientChecked = true and administrativeDetailsChecked = true and clinicalCorrectionRequested != true then string(now()) else null" },
   Retry: {}
  }[n.id];
  for(const m of n.body.matchAll(/<zeebe:output source="= ([^"]+)" target="([^"]+)"\s*\/>/g)){
   if (Object.hasOwn(computed,m[2])) assert.equal(m[1],computed[m[2]]);
   else { assert.equal(m[1],m[2]); assert.ok(fields.has(m[2])); }
  }
  if(["Admin","Retry"].includes(n.id)) assert.doesNotMatch(n.body,/target="clinicalApproved"/);
 }
});
test("approval, administrative checks and retry have guarded defaults",()=>{
 for(const id of ["Approved","AdminReady","RetryReady"]){
  const g=nodes.find(n=>n.id===id);
  const out=flows.filter(f=>f.sourceRef===id);
  assert.equal(out.length,id==="AdminReady"?3:2);
  assert.ok(out.find(f=>f.id===g.default&&!f.body.includes("conditionExpression")));
  assert.equal(out.filter(f=>f.body.includes("conditionExpression")).length,id==="AdminReady"?2:1);
 }
 assert.match(flows.find(f=>f.id==="Flow_Approved").body,/clinicalApproved = true/);
 assert.match(flows.find(f=>f.id==="Flow_AdminOK").body,/recipientChecked = true and administrativeDetailsChecked = true/);
 assert.match(flows.find(f=>f.id==="Flow_AdminOK").body,/clinicalCorrectionRequested != true/);
 assert.match(flows.find(f=>f.id==="Flow_RetryDispatch").body,/retryAuthorised = true/);
});

test("all drafting and rework entries pass through the trusted stage-start worker",()=>{
 assert.deepEqual(flows.filter(f=>f.targetRef==="Draft").map(f=>f.sourceRef),["RecordDraftStart"]);
 assert.deepEqual(flows.filter(f=>f.targetRef==="RecordDraftStart").map(f=>f.sourceRef).sort(),["AdminReady","Approved","Split"]);
 assert.match(nodes.find(n=>n.id==="RecordDraftStart").body,/clinic-letter.sprint02.record-draft-start/);
 assert.match(nodes.find(n=>n.id==="Draft").body,/source="= false" target="clinicalApproved"/);
});

test("secretary clinical correction returns to consultant without reusing old approval",()=>{
 const f=flows.find(f=>f.id==="Flow_ClinicalCorrection");
 assert.equal(f.targetRef,"RecordDraftStart");
 assert.match(f.body,/clinicalCorrectionRequested = true/);
 const admin=nodes.find(n=>n.id==="Admin").body;
 for (const field of ["clinicalApproved","clinicalSummary","diagnosis","clinicalFindings","treatmentDecisions","followUpPlan","communicationInstructions","intendedRecipients"]) {
  assert.doesNotMatch(admin,new RegExp('target="'+field+'"'));
 }
});

test("draft and clinical review expose all case-study letter content and recipients",async()=>{
 const draft=JSON.parse(await readFile(new URL("forms/clinic-letter-draft-sprint02.form",base),"utf8"));
 const approval=JSON.parse(await readFile(new URL("forms/clinic-letter-clinical-approval-sprint02.form",base),"utf8"));
 const context=approval.components.filter(c=>c.type==="text").map(c=>c.text).join("\n");
 for (const key of ["letterType","clinicalSummary","diagnosis","clinicalFindings","treatmentDecisions","followUpPlan","communicationInstructions","intendedRecipients"]) {
  assert.ok(draft.components.some(c=>c.key===key&&c.validate.required),key);
  assert.ok(context.includes("{{"+key+"}}"),key);
  assert.ok(nodes.find(n=>n.id==="Draft").body.includes('target="'+key+'"'));
 }
 const types=draft.components.find(c=>c.key==="letterType").values.map(v=>v.value);
 assert.deepEqual(types,["NEW_PATIENT","FOLLOW_UP"]);
});

test("delay reasons stay within existing authorised task forms, without extra task loops",async()=>{
 assert.equal(nodes.filter(n=>n.type==="userTask").length,4);
 for(const n of nodes.filter(n=>n.type==="userTask")){
  const id=n.body.match(/formId="([^"]+)"/)[1];
  const form=JSON.parse(await readFile(new URL("forms/"+id+".form",base),"utf8"));
  assert.ok(form.components.some(c=>c.key==="delayReason"&&c.validate.maxLength===500));
  assert.match(n.body,/target="delayReason"/);
  assert.match(n.body,/candidateGroups="consultants"|candidateGroups="medical-secretaries"/);
 }
 const draft=JSON.parse(await readFile(new URL("forms/clinic-letter-draft-sprint02.form",base),"utf8"));
 const context=draft.components.filter(c=>c.type==="text").map(c=>c.text).join("\n");
 assert.ok(context.includes("{{rejectionReason}}"));
 assert.ok(context.includes("{{clinicalCorrectionReason}}"));
});

test("clinical stage timestamps are computed by engine, never editable form inputs",async()=>{
 for(const n of nodes.filter(n=>n.type==="userTask")){
  const id=n.body.match(/formId="([^"]+)"/)[1];
  const form=JSON.parse(await readFile(new URL("forms/"+id+".form",base),"utf8"));
  for(const key of ["draftStartedAt","draftCompletedAt","approvedAt","administrativeProcessedAt","letterSentAt","distributionMethod"]) {
   assert.ok(!form.components.some(c=>c.key===key),key);
  }
 }
 assert.match(nodes.find(n=>n.id==="Draft").body,/string\(now\(\)\).*draftCompletedAt/);
 assert.match(nodes.find(n=>n.id==="Approve").body,/clinicalApproved = true then string\(now\(\)\) else null/);
});
test("production deadlines use original consultation and calendar months independently",()=>{
 for(const [id,duration]of [["SevenDays","P7D"],["OneMonth","P1M"],["ThreeMonths","P3M"]]){
  assert.match(nodes.find(n=>n.id===id).body,/<bpmn:timeDate>/);
  assert.ok(nodes.find(n=>n.id===id).body.includes('duration(&quot;'+duration+'&quot;)'));
  assert.match(nodes.find(n=>n.id===id).body,/consultationCompletedAt/);
  assert.ok(flows.some(f=>f.sourceRef==="Split"&&f.targetRef===id));
 }
 assert.match(nodes.find(n=>n.id==="Week").body,/<bpmn:timeDuration>P7D<\/bpmn:timeDuration>/);
 assert.ok(flows.some(f=>f.sourceRef==="Week"&&f.targetRef==="Reminder"));
});
test("demo durations are separate and clearly labelled",()=>{
 assert.match(demo,/Process_ClinicLetterSprint02Demo/);
 assert.match(demo,/DEMO ONLY/);
 for(const d of ["PT10S","PT20S","PT30S"])assert.ok(demo.includes(d));
 assert.doesNotMatch(xml,/PT10S|PT20S|PT30S/);
});
test("send terminates process-local monitoring; milestone ends do not terminate",()=>{
 assert.match(nodes.find(n=>n.id==="Sent").body,/terminateEventDefinition/);
 for(const id of ["MonthDone","ThreeDone"])assert.doesNotMatch(nodes.find(n=>n.id===id).body,/terminateEventDefinition/);
 assert.ok(flows.some(f=>f.sourceRef==="Dispatch"&&f.targetRef==="Sent"));
});
test("dispatch is isolated and has interrupting business-error resolution route",()=>{
 assert.match(nodes.find(n=>n.id==="Dispatch").body,/type="clinic-letter.sprint02.dispatch" retries="3"/);
 const boundary=nodes.find(n=>n.id==="DispatchError");
 assert.equal(boundary.attachedToRef,"Dispatch");assert.equal(boundary.cancelActivity,"true");
 assert.match(boundary.body,/errorRef="Error_DispatchRejected"/);
 assert.match(xml,/errorCode="CLINIC_LETTER_DISPATCH_REJECTED"/);
 assert.ok(flows.some(f=>f.sourceRef==="DispatchError"&&f.targetRef==="Retry"));
});
test("all configured service jobs are implemented by the demo handler",async()=>{
 const {JOB_TYPES,DEMO_JOB_TYPES}=await import("../worker.mjs");
 for(const n of nodes.filter(n=>n.type==="serviceTask")){
  const type=n.body.match(/<zeebe:taskDefinition type="([^"]+)"/)[1];
  assert.ok(Object.values(JOB_TYPES).includes(type),type);
 }
 for(const m of demo.matchAll(/<zeebe:taskDefinition type="([^"]+)"/g)) {
  assert.ok(Object.values(DEMO_JOB_TYPES).includes(m[1]),m[1]);
  assert.ok(!Object.values(JOB_TYPES).includes(m[1]));
 }
});
test("form keys and component IDs are unique per form",async()=>{
 for(const name of await readdir(new URL("forms/",base))){
  const f=JSON.parse(await readFile(new URL("forms/"+name,base),"utf8"));
  const componentIds=f.components.map(c=>c.id);assert.equal(new Set(componentIds).size,componentIds.length);
  const keys=f.components.filter(c=>c.key).map(c=>c.key);assert.equal(new Set(keys).size,keys.length);
 }
});
