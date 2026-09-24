$ErrorActionPreference = 'Stop'
$bpmnNs = 'http://www.omg.org/spec/BPMN/20100524/MODEL'; $diNs = 'http://www.omg.org/spec/BPMN/20100524/DI'; $dcNs = 'http://www.omg.org/spec/DD/20100524/DC'; $diagramNs = 'http://www.omg.org/spec/DD/20100524/DI'
$path = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'models') '00-integrated-hospital-patient-administration.bpmn'
$annotations = @(
  @{ id='TA_ReferralResponsibility'; target='R_CheckDocuments'; text='Medical Secretaries check document completeness only. A Consultant makes the clinical referral decision.' },
  @{ id='TA_AppointmentUrgency'; target='R_PhoneNeeded'; text='If the appointment is within two weeks, telephone contact is also required. Record every attempt and outcome.' },
  @{ id='TA_TreatmentAuthorisation'; target='T_Authorised'; text='An incomplete or unauthorised treatment request must not be processed by administrative staff.' },
  @{ id='TA_PaymentInvestigation'; target='T_InvestigatePayment'; text='Missing provider confirmation may follow a successful payment. Investigate it; do not automatically request another payment.' },
  @{ id='TA_ClinicalEnquiryBoundary'; target='Q_ClinicalTriage'; text='Call handlers do not diagnose, interpret results or recommend treatment. Urgent clinical concerns go to qualified clinical staff.' }
)
[xml]$doc = Get-Content -LiteralPath $path -Raw
$ns=[System.Xml.XmlNamespaceManager]::new($doc.NameTable);$ns.AddNamespace('bpmn',$bpmnNs);$ns.AddNamespace('bpmndi',$diNs);$ns.AddNamespace('dc',$dcNs)
$process=$doc.SelectSingleNode('//bpmn:process',$ns);$plane=$doc.SelectSingleNode('//bpmndi:BPMNPlane',$ns)
foreach($item in $annotations){
  $existing=$doc.SelectSingleNode("//*[@id='$($item.id)']");if($existing){[void]$existing.ParentNode.RemoveChild($existing)}
  foreach($elementId in @("Association_$($item.id)","$($item.id)_di","Association_$($item.id)_di")){ $node=$doc.SelectSingleNode("//*[@id='$elementId']");if($node){[void]$node.ParentNode.RemoveChild($node)} }
  $targetShape=$plane.SelectSingleNode("./bpmndi:BPMNShape[@bpmnElement='$($item.target)']",$ns);if(-not $targetShape){throw "No shape for $($item.target)"};$tb=$targetShape.SelectSingleNode('./dc:Bounds',$ns);$x=[double]$tb.GetAttribute('x');$y=[math]::Max(20,[double]$tb.GetAttribute('y')-100)
  $annotation=$doc.CreateElement('bpmn','textAnnotation',$bpmnNs);$annotation.SetAttribute('id',$item.id);$text=$doc.CreateElement('bpmn','text',$bpmnNs);$text.InnerText=$item.text;[void]$annotation.AppendChild($text);[void]$process.AppendChild($annotation)
  $shape=$doc.CreateElement('bpmndi','BPMNShape',$diNs);$shape.SetAttribute('id',"$($item.id)_di");$shape.SetAttribute('bpmnElement',$item.id);$bounds=$doc.CreateElement('dc','Bounds',$dcNs);$bounds.SetAttribute('x',[string]$x);$bounds.SetAttribute('y',[string]$y);$bounds.SetAttribute('width','330');$bounds.SetAttribute('height','65');[void]$shape.AppendChild($bounds);[void]$plane.AppendChild($shape)
  $association=$doc.CreateElement('bpmn','association',$bpmnNs);$association.SetAttribute('id',"Association_$($item.id)");$association.SetAttribute('sourceRef',$item.target);$association.SetAttribute('targetRef',$item.id);[void]$process.AppendChild($association)
  $edge=$doc.CreateElement('bpmndi','BPMNEdge',$diNs);$edge.SetAttribute('id',"Association_$($item.id)_di");$edge.SetAttribute('bpmnElement',"Association_$($item.id)");foreach($point in @(@{x=$x+165;y=$y+65},@{x=[double]$tb.GetAttribute('x')+[double]$tb.GetAttribute('width')/2;y=[double]$tb.GetAttribute('y')})){$waypoint=$doc.CreateElement('di','waypoint',$diagramNs);$waypoint.SetAttribute('x',[string]$point.x);$waypoint.SetAttribute('y',[string]$point.y);[void]$edge.AppendChild($waypoint)};[void]$plane.AppendChild($edge)
}
$settings=[System.Xml.XmlWriterSettings]::new();$settings.Indent=$true;$settings.Encoding=[System.Text.UTF8Encoding]::new($false);$writer=[System.Xml.XmlWriter]::Create($path,$settings);$doc.Save($writer);$writer.Close();Write-Output "Added $($annotations.Count) annotations to $(Split-Path -Leaf $path)"
