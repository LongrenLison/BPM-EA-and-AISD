$ErrorActionPreference = 'Stop'

$modelDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'models'
$modelFiles = @(
  '01-referral-and-first-appointment.bpmn',
  '02-treatment-booking-and-funding.bpmn',
  '03-patient-enquiry-routing.bpmn'
)
$bpmnNs = 'http://www.omg.org/spec/BPMN/20100524/MODEL'
$diNs = 'http://www.omg.org/spec/BPMN/20100524/DI'
$dcNs = 'http://www.omg.org/spec/DD/20100524/DC'

function Add-Bounds($document, $parent, [double]$x, [double]$y, [double]$width, [double]$height) {
  $bounds = $document.CreateElement('dc', 'Bounds', $dcNs)
  $bounds.SetAttribute('x', [string]$x); $bounds.SetAttribute('y', [string]$y)
  $bounds.SetAttribute('width', [string]$width); $bounds.SetAttribute('height', [string]$height)
  [void]$parent.AppendChild($bounds)
}

foreach ($modelFile in $modelFiles) {
  $path = Join-Path $modelDirectory $modelFile
  $document = [xml](Get-Content -LiteralPath $path -Raw)
  $ns = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
  $ns.AddNamespace('bpmn', $bpmnNs); $ns.AddNamespace('bpmndi', $diNs); $ns.AddNamespace('dc', $dcNs)
  $process = $document.SelectSingleNode('//bpmn:process', $ns)
  $plane = $document.SelectSingleNode('//bpmndi:BPMNPlane', $ns)
  if ($null -eq $process -or $null -eq $plane) { throw "Process or diagram plane missing in $modelFile" }
  $flowNodes = @($process.ChildNodes | Where-Object { $_.NamespaceURI -eq $bpmnNs -and $_.LocalName -in @('startEvent','endEvent','userTask','serviceTask','exclusiveGateway','parallelGateway','intermediateCatchEvent','boundaryEvent') })
  $nodeIds = @($flowNodes | ForEach-Object { $_.GetAttribute('id') })
  # Remove only previously generated flow-node shapes and sequence-flow edges; retain pool and lane shapes.
  foreach ($child in @($plane.ChildNodes)) {
    if ($child.LocalName -eq 'BPMNEdge' -or ($child.LocalName -eq 'BPMNShape' -and $nodeIds -contains $child.GetAttribute('bpmnElement'))) { [void]$plane.RemoveChild($child) }
  }

  # Make every pool and lane wide enough for the complete process.
  foreach ($shape in $plane.SelectNodes('./bpmndi:BPMNShape', $ns)) {
    $bounds = $shape.SelectSingleNode('./dc:Bounds', $ns)
    if ($bounds -and [double]$bounds.GetAttribute('width') -lt 3900) { $bounds.SetAttribute('width', '3900') }
  }

  $laneByNode = @{}
  $laneBounds = @{}
  foreach ($lane in $process.SelectNodes('.//bpmn:lane', $ns)) {
    $laneId = $lane.GetAttribute('id')
    foreach ($ref in $lane.SelectNodes('./bpmn:flowNodeRef', $ns)) { $laneByNode[$ref.InnerText.Trim()] = $laneId }
    $laneShape = $plane.SelectSingleNode("./bpmndi:BPMNShape[@bpmnElement='$laneId']", $ns)
    $bounds = $laneShape.SelectSingleNode('./dc:Bounds', $ns)
    $laneBounds[$laneId] = @{ x = [double]$bounds.GetAttribute('x'); y = [double]$bounds.GetAttribute('y'); height = [double]$bounds.GetAttribute('height') }
  }

  $geometry = @{}
  $index = 0
  $lastLaneId = ($laneBounds.Keys | Select-Object -First 1)
  foreach ($node in $flowNodes) {
    $id = $node.GetAttribute('id')
    $laneId = $laneByNode[$id]
    if ($node.LocalName -eq 'boundaryEvent') {
      $attachedId = $node.GetAttribute('attachedToRef')
      if ($geometry.ContainsKey($attachedId)) {
        $attached = $geometry[$attachedId]
        $x = $attached.x + $attached.w - 20; $y = $attached.y - 18; $w = 36; $h = 36
      } else { $x = 150 + ($index * 145); $y = 100; $w = 36; $h = 36 }
    } else {
      if ([string]::IsNullOrEmpty($laneId) -or -not $laneBounds.ContainsKey($laneId)) { $laneId = $lastLaneId }
      $lane = $laneBounds[$laneId]
      $x = 150 + ($index * 150)
      $y = $lane.y + (($lane.height - 70) / 2)
      if ($node.LocalName -in @('startEvent','endEvent','intermediateCatchEvent')) { $w = 36; $h = 36; $y = $lane.y + (($lane.height - $h) / 2) }
      elseif ($node.LocalName -in @('exclusiveGateway','parallelGateway')) { $w = 50; $h = 50; $y = $lane.y + (($lane.height - $h) / 2) }
      else { $w = 120; $h = 70 }
    }
    $shape = $document.CreateElement('bpmndi', 'BPMNShape', $diNs)
    $shape.SetAttribute('id', "${id}_di")
    $shape.SetAttribute('bpmnElement', $id)
    Add-Bounds $document $shape $x $y $w $h
    [void]$plane.AppendChild($shape)
    $geometry[$id] = @{ x=$x; y=$y; w=$w; h=$h }
    if ($node.LocalName -ne 'boundaryEvent') { $lastLaneId = $laneId }
    $index++
  }

  foreach ($flow in $process.SelectNodes('./bpmn:sequenceFlow', $ns)) {
    $sourceId = $flow.GetAttribute('sourceRef'); $targetId = $flow.GetAttribute('targetRef')
    if (-not $geometry.ContainsKey($sourceId) -or -not $geometry.ContainsKey($targetId)) { continue }
    $source = $geometry[$sourceId]; $target = $geometry[$targetId]
    $edge = $document.CreateElement('bpmndi', 'BPMNEdge', $diNs)
    $edge.SetAttribute('id', "$($flow.GetAttribute('id'))_di")
    $edge.SetAttribute('bpmnElement', $flow.GetAttribute('id'))
    $start = $document.CreateElement('di', 'waypoint', 'http://www.omg.org/spec/DD/20100524/DI')
    $start.SetAttribute('x', [string]($source.x + $source.w)); $start.SetAttribute('y', [string]($source.y + ($source.h / 2)))
    $finish = $document.CreateElement('di', 'waypoint', 'http://www.omg.org/spec/DD/20100524/DI')
    $finish.SetAttribute('x', [string]$target.x); $finish.SetAttribute('y', [string]($target.y + ($target.h / 2)))
    [void]$edge.AppendChild($start); [void]$edge.AppendChild($finish); [void]$plane.AppendChild($edge)
  }
  $writer = [System.Xml.XmlWriter]::Create($path, [System.Xml.XmlWriterSettings]@{ Indent = $true; Encoding = [System.Text.UTF8Encoding]::new($false) })
  $document.Save($writer); $writer.Close()
  Write-Output "Laid out $modelFile"
}
