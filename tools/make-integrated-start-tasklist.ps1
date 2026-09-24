$ErrorActionPreference = 'Stop'
$path = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'models') '00-integrated-hospital-patient-administration.bpmn'
$bpmnNs='http://www.omg.org/spec/BPMN/20100524/MODEL';$diNs='http://www.omg.org/spec/BPMN/20100524/DI';$dcNs='http://www.omg.org/spec/DD/20100524/DC';$diagramNs='http://www.omg.org/spec/DD/20100524/DI'
[xml]$document=Get-Content -LiteralPath $path -Raw
$ns=[System.Xml.XmlNamespaceManager]::new($document.NameTable);$ns.AddNamespace('bpmn',$bpmnNs);$ns.AddNamespace('bpmndi',$diNs);$ns.AddNamespace('dc',$dcNs);$ns.AddNamespace('di',$diagramNs)
$start=$document.SelectSingleNode('//bpmn:startEvent[@id="Start_Journey"]',$ns);if(-not $start){throw 'Start_Journey not found'}
foreach($messageDefinition in @($start.SelectNodes('./bpmn:messageEventDefinition',$ns))){[void]$start.RemoveChild($messageDefinition)}
$messageFlow=$document.SelectSingleNode('//bpmn:messageFlow[@id="MF_ReferralReceived"]',$ns);if(-not $messageFlow){throw 'MF_ReferralReceived not found'};$messageFlow.SetAttribute('targetRef','R_CheckDocuments')
$plane=$document.SelectSingleNode('//bpmndi:BPMNPlane',$ns);$edge=$plane.SelectSingleNode('./bpmndi:BPMNEdge[@bpmnElement="MF_ReferralReceived"]',$ns);if(-not $edge){throw 'Message-flow edge not found'}
$targetShape=$plane.SelectSingleNode('./bpmndi:BPMNShape[@bpmnElement="R_CheckDocuments"]',$ns);$bounds=$targetShape.SelectSingleNode('./dc:Bounds',$ns);$targetX=[double]$bounds.GetAttribute('x');$targetY=[double]$bounds.GetAttribute('y')+([double]$bounds.GetAttribute('height')/2)
$waypoints=@($edge.SelectNodes('./di:waypoint',$ns));if($waypoints.Count -gt 0){$last=$waypoints[$waypoints.Count-1];$last.SetAttribute('x',[string]$targetX);$last.SetAttribute('y',[string]$targetY)}
$start.SetAttribute('name','Referral registered')
$settings=[System.Xml.XmlWriterSettings]::new();$settings.Indent=$true;$settings.Encoding=[System.Text.UTF8Encoding]::new($false);$writer=[System.Xml.XmlWriter]::Create($path,$settings);$document.Save($writer);$writer.Close();Write-Output 'Converted Start_Journey to None Start Event and redirected referral Message Flow to R_CheckDocuments.'
