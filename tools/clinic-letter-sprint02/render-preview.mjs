import {readFile,writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
const xml=await readFile(new URL("clinic-letter-sprint02.bpmn",import.meta.url),"utf8");
const escape=s=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const decode=s=>s.replaceAll("&quot;",'"').replaceAll("&gt;",">").replaceAll("&lt;","<").replaceAll("&amp;","&");
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const model=new Map([...xml.matchAll(/<bpmn:(lane|startEvent|endEvent|userTask|serviceTask|parallelGateway|exclusiveGateway|intermediateCatchEvent|boundaryEvent)\b([^>]*)>/g)].map(m=>{const a=attrs(m[2]);return[a.id,{...a,type:m[1]}]}));
const flows=new Map([...xml.matchAll(/<bpmn:sequenceFlow\b([^>]*)>/g)].map(m=>{const a=attrs(m[1]);return[a.id,a]}));
const shapes=[...xml.matchAll(/<bpmndi:BPMNShape\b([^>]*)>([\s\S]*?)<\/bpmndi:BPMNShape>/g)].map(m=>({...attrs(m[1]),...attrs(m[2].match(/<dc:Bounds\b([^>]*)/)[1])}));
const edges=[...xml.matchAll(/<bpmndi:BPMNEdge\b([^>]*)>([\s\S]*?)<\/bpmndi:BPMNEdge>/g)].map(m=>({...attrs(m[1]),pts:[...m[2].matchAll(/<di:waypoint\b([^>]*)/g)].map(p=>attrs(p[1])),label:m[2].includes("<bpmndi:BPMNLabel>")?attrs(m[2].match(/<dc:Bounds\b([^>]*)/)[1]):null}));
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1940" height="1220" viewBox="0 0 1940 1220"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8" fill="#334155"/></marker></defs><rect width="1940" height="1220" fill="white"/><g font-family="Arial,sans-serif" font-size="14" fill="#142b45">';
svg+='<text x="35" y="23" font-size="20" font-weight="bold">Clinic Letter - Sprint 02 (simulated correspondence)</text>';
for(const s of shapes.filter(s=>model.get(s.bpmnElement).type==="lane")){
 const n=model.get(s.bpmnElement);svg+='<rect x="'+s.x+'" y="'+s.y+'" width="'+s.width+'" height="'+s.height+'" fill="#f4f8fc" stroke="#9aaebf"/><text transform="translate(52,'+(+s.y + +s.height/2)+') rotate(-90)" text-anchor="middle" font-size="13">'+escape(n.name)+'</text>';
}
for(const e of edges){
 const p=e.pts;svg+='<polyline points="'+p.map(a=>a.x+','+a.y).join(" ")+'" fill="none" stroke="#334155" stroke-width="1.5" marker-end="url(#arrow)"/>';
 const f=flows.get(e.bpmnElement);if(f?.name){const at=p[Math.min(1,p.length-1)],lx=e.label?+e.label.x:+at.x+7,ly=e.bpmnElement==="Flow_Approved"?245:e.label?+e.label.y+13:+at.y-8;svg+='<text x="'+lx+'" y="'+ly+'" font-size="11" fill="#294c71">'+escape(f.name)+'</text>';}
}
function lines(label,size=26){const words=label.split(" ");const result=[];let l="";for(const w of words){if((l+" "+w).trim().length>size){result.push(l);l=w;}else l=(l+" "+w).trim();}if(l)result.push(l);return result;}
for(const s of shapes.filter(s=>model.get(s.bpmnElement).type!=="lane")){
 const n=model.get(s.bpmnElement),x=+s.x,y=+s.y,w=+s.width,h=+s.height,cx=x+w/2,cy=y+h/2;
 if(["userTask","serviceTask"].includes(n.type)){
 svg+='<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="9" fill="white" stroke="#334155" stroke-width="1.8"/><text x="'+(x+9)+'" y="'+(y+17)+'" font-weight="bold" font-size="12">'+(n.type==="userTask"?"U":"S")+'</text>';
 const ls=lines(n.name,Math.max(12,Math.floor((w-16)/7.5)));ls.forEach((l,i)=>{svg+='<text x="'+cx+'" y="'+(cy-(ls.length-1)*8+i*16)+'" text-anchor="middle">'+escape(l)+'</text>';});
 }else if(n.type.includes("Gateway")){
 svg+='<polygon points="'+cx+','+y+' '+(x+w)+','+cy+' '+cx+','+(y+h)+' '+x+','+cy+'" fill="white" stroke="#334155" stroke-width="1.8"/><text x="'+cx+'" y="'+(cy+7)+'" text-anchor="middle" font-size="26">'+(n.type==="parallelGateway"?"+":"×")+'</text>';
 }else{
 svg+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(w/2)+'" fill="white" stroke="#334155" stroke-width="'+(n.type==="endEvent"?3:1.8)+'"/>';
 if(["intermediateCatchEvent","boundaryEvent"].includes(n.type))svg+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(w/2-4)+'" fill="none" stroke="#334155"/>';
 if(n.id==="Sent")svg+='<circle cx="'+cx+'" cy="'+cy+'" r="11" fill="#334155"/>';
 if(n.type==="intermediateCatchEvent")svg+='<path d="M'+cx+','+(cy-10)+'V'+cy+'L'+(cx+7)+','+(cy+4)+'" fill="none" stroke="#334155" stroke-width="2"/>';
 if(n.type==="boundaryEvent")svg+='<text x="'+cx+'" y="'+(cy+5)+'" text-anchor="middle">!</text>';
 }
 if(!["userTask","serviceTask"].includes(n.type)){lines(n.name,25).forEach((l,i)=>{svg+='<text x="'+cx+'" y="'+(y+h+18+i*15)+'" text-anchor="middle" font-size="12">'+escape(l)+'</text>';});}
}
svg+='<text x="35" y="1200" font-size="13">U = human task, S = simulated service task. Calendar-month milestones run independently; successful dispatch cancels process-local monitoring.</text></g></svg>';
await writeFile(new URL("clinic-letter-preview.svg",import.meta.url),svg,"utf8");
if(process.argv[2]){
 const require=createRequire(import.meta.url);const sharp=require(process.argv[2]);
 await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL("clinic-letter-preview.png",import.meta.url)));
}
console.log("DI-based SVG preview generated; PNG generated when sharp path supplied.");
