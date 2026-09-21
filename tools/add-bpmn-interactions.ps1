$ErrorActionPreference = 'Stop'
$bpmnNs = 'http://www.omg.org/spec/BPMN/20100524/MODEL'; $diNs = 'http://www.omg.org/spec/BPMN/20100524/DI'; $dcNs = 'http://www.omg.org/spec/DD/20100524/DC'
$root = Split-Path -Parent $PSScriptRoot
$specifications = @{
  '01-referral-and-first-appointment.bpmn' = @{ messages=@(
    @{id='MF_ReferralReceived'; name='Referral and supporting documents'; source='Referrer'; target='Start_Referral'},
    @{id='MF_RequestMissingInfo'; name='Request for missing information'; source='RequestInformation'; target='Referrer'},
    @{id='MF_AppointmentLetter'; name='Appointment letter request'; source='NotifyPatient'; target='Correspondence'},
    @{id='MF_AppointmentNotification'; name='Appointment notification'; source='Correspondence'; target='Patient_Referral'}
  ); annotations=@(
    @{id='TA_SecretaryBoundary'; target='CheckDocuments'; text='Medical Secretaries check completeness only. A Consultant makes the clinical acceptance decision.'},
    @{id='TA_Timeframe'; target='EscalateNoSlot'; text='Do not silently book outside the Consultant requested timeframe. Escalate the capacity issue.'},
    @{id='TA_TwoWeeks'; target='PhoneNeeded'; text='For appointments within two weeks, telephone contact is also required. Record every attempt and outcome.'}
  ) }
  '02-treatment-booking-and-funding.bpmn' = @{ messages=@(
    @{id='MF_CapacityRequest'; name='Capacity request'; source='CheckCapacity'; target='External_Treatment'},
    @{id='MF_PaymentRequest'; name='Secure payment request'; source='TakePayment'; target='PSP'},
    @{id='MF_PaymentStatus'; name='Payment status and transaction reference'; source='PSP'; target='PaymentOutcome'},
    @{id='MF_PaymentIssueNotice'; name='Payment issue notification'; source='NotifyPaymentIssue'; target='Patient_Treatment'}
  ); annotations=@(
    @{id='TA_Authorisation'; target='AuthoriseRequest'; text='Administrative staff must not process an incomplete or unauthorised treatment request.'},
    @{id='TA_PaymentSafety'; target='InvestigatePayment'; text='A provider payment may have succeeded even when confirmation is absent. Investigate; do not automatically charge again.'},
    @{id='TA_UrgentOverride'; target='UrgentOverride'; text='Urgent treatment may proceed only on recorded clinical authorisation and requires Finance follow-up.'}
  ) }
  '03-patient-enquiry-routing.bpmn' = @{ messages=@(
    @{id='MF_PatientEnquiry'; name='Patient enquiry'; source='Patient_Enquiry'; target='S_Enquiry'},
    @{id='MF_ResolutionNotice'; name='Recorded response and resolution'; source='NotifyResolution'; target='Patient_Enquiry'}
  ); annotations=@(
    @{id='TA_NoClinicalAdvice'; target='RecordClassify'; text='Call handlers may answer authorised administrative questions but must not diagnose, interpret results or recommend treatment.'},
    @{id='TA_UrgentClinical'; target='ClinicalTriage'; text='Urgent clinical concerns are highlighted immediately and routed to an appropriately qualified clinical professional.'}
  ) }
}

function New-Element($document, $prefix, $name, $namespace) { $document.CreateElement($prefix, $name, $namespace) }
function Bounds-For($plane, $ns, $id) {
  $shape = $plane.SelectSingleNode("./bpmndi:BPMNShape[@bpmnElement='$id']", $ns)
  if ($null -eq $shape) { throw "No BPMN-DI shape for $id" }
  $b = $shape.SelectSingleNode('./dc:Bounds', $ns)
  @{ x=[double]$b.GetAttribute('x'); y=[double]$b.GetAttribute('y'); w=[double]$b.GetAttribute('width'); h=[double]$b.GetAttribute('height') }
}
function Add-Waypoint($document, $edge, [double]$x, [double]$y) {
  $point = New-Element $document 'di' 'waypoint' 'http://www.omg.org/spec/DD/20100524/DI'; $point.SetAttribute('x',[string]$x); $point.SetAttribute('y',[string]$y); [void]$edge.AppendChild($point)
}
function Add-Edge($document, $plane, $id, $elementId, $from, $to) {
  $edge = New-Element $document 'bpmndi' 'BPMNEdge' $diNs; $edge.SetAttribute('id',"${id}_di"); $edge.SetAttribute('bpmnElement',$elementId)
  Add-Waypoint $document $edge ($from.x + $from.w / 2) ($from.y + $from.h / 2); Add-Waypoint $document $edge ($to.x + $to.w / 2) ($to.y + $to.h / 2); [void]$plane.AppendChild($edge)
}

foreach ($entry in $specifications.GetEnumerator()) {
  $path = Join-Path (Join-Path $root 'models') $entry.Key; [xml]$document = Get-Content -LiteralPath $path -Raw
  $ns = [System.Xml.XmlNamespaceManager]::new($document.NameTable); $ns.AddNamespace('bpmn',$bpmnNs); $ns.AddNamespace('bpmndi',$diNs); $ns.AddNamespace('dc',$dcNs)
  $definitions=$document.DocumentElement; $process=$document.SelectSingleNode('//bpmn:process',$ns); $collaboration=$document.SelectSingleNode('//bpmn:collaboration',$ns); $plane=$document.SelectSingleNode('//bpmndi:BPMNPlane',$ns)
  # Make the operation repeatable by removing prior generated interaction elements and graphics.
  foreach ($item in @($entry.Value.messages) + @($entry.Value.annotations)) {
    $node=$document.SelectSingleNode("//*[@id='$($item.id)']"); if($node){[void]$node.ParentNode.RemoveChild($node)}
    $shape=$plane.SelectSingleNode("./bpmndi:BPMNShape[@bpmnElement='$($item.id)']",$ns); if($shape){[void]$plane.RemoveChild($shape)}
    $edge=$plane.SelectSingleNode("./bpmndi:BPMNEdge[@bpmnElement='$($item.id)']",$ns); if($edge){[void]$plane.RemoveChild($edge)}
    $association=$document.SelectSingleNode("//*[@id='Association_$($item.id)']"); if($association){[void]$association.ParentNode.RemoveChild($association)}
    $associationEdge=$plane.SelectSingleNode("./bpmndi:BPMNEdge[@bpmnElement='Association_$($item.id)']",$ns); if($associationEdge){[void]$plane.RemoveChild($associationEdge)}
  }
  foreach ($message in $entry.Value.messages) {
    $messageId="Message_$($message.id)"; if(-not $document.SelectSingleNode("//*[@id='$messageId']")) { $definition=New-Element $document 'bpmn' 'message' $bpmnNs; $definition.SetAttribute('id',$messageId); $definition.SetAttribute('name',$message.name); [void]$definitions.InsertBefore($definition,$collaboration) }
    $flow=New-Element $document 'bpmn' 'messageFlow' $bpmnNs; $flow.SetAttribute('id',$message.id); $flow.SetAttribute('name',$message.name); $flow.SetAttribute('sourceRef',$message.source); $flow.SetAttribute('targetRef',$message.target); $flow.SetAttribute('messageRef',$messageId); [void]$collaboration.AppendChild($flow)
    Add-Edge $document $plane "Message_$($message.id)" $message.id (Bounds-For $plane $ns $message.source) (Bounds-For $plane $ns $message.target)
  }
  $annotationIndex=0
  foreach ($annotation in $entry.Value.annotations) {
    $target=Bounds-For $plane $ns $annotation.target; $x=$target.x; $y=[math]::Max(20,$target.y-105); $w=310; $h=65
    $textAnnotation=New-Element $document 'bpmn' 'textAnnotation' $bpmnNs; $textAnnotation.SetAttribute('id',$annotation.id); $text=New-Element $document 'bpmn' 'text' $bpmnNs; $text.InnerText=$annotation.text; [void]$textAnnotation.AppendChild($text); [void]$process.AppendChild($textAnnotation)
    $shape=New-Element $document 'bpmndi' 'BPMNShape' $diNs; $shape.SetAttribute('id',"$($annotation.id)_di"); $shape.SetAttribute('bpmnElement',$annotation.id); $bounds=New-Element $document 'dc' 'Bounds' $dcNs; $bounds.SetAttribute('x',[string]$x); $bounds.SetAttribute('y',[string]$y); $bounds.SetAttribute('width',[string]$w); $bounds.SetAttribute('height',[string]$h); [void]$shape.AppendChild($bounds); [void]$plane.AppendChild($shape)
    $association=New-Element $document 'bpmn' 'association' $bpmnNs; $association.SetAttribute('id',"Association_$($annotation.id)"); $association.SetAttribute('sourceRef',$annotation.target); $association.SetAttribute('targetRef',$annotation.id); [void]$process.AppendChild($association)
    Add-Edge $document $plane "Association_$($annotation.id)" "Association_$($annotation.id)" $target @{x=$x;y=$y;w=$w;h=$h}; $annotationIndex++
  }
  $settings=[System.Xml.XmlWriterSettings]::new(); $settings.Indent=$true; $settings.Encoding=[System.Text.UTF8Encoding]::new($false); $writer=[System.Xml.XmlWriter]::Create($path,$settings); $document.Save($writer); $writer.Close(); Write-Output "Added interactions to $($entry.Key)"
}
