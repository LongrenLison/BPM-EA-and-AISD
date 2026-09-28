param(
    [string]$InputPath = (Join-Path $PSScriptRoot 'chemotherapy-cycle-review-optimized.bpmn'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'chemotherapy-cycle-review-final.svg')
)

$ErrorActionPreference = 'Stop'
[xml]$document = Get-Content -LiteralPath $InputPath -Raw
$invariant = [Globalization.CultureInfo]::InvariantCulture
$parts = [System.Collections.Generic.List[string]]::new()

function Format-Number([double]$value) {
    return $value.ToString('0.##', $invariant)
}

function Escape-Xml([string]$value) {
    return [System.Security.SecurityElement]::Escape($value)
}

function Wrap-Text([string]$value, [int]$maxChars) {
    if ([string]::IsNullOrWhiteSpace($value)) { return @() }
    $maxChars = [Math]::Max(8, $maxChars)
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($paragraph in ($value -split "`r?`n")) {
        $line = ''
        foreach ($word in ($paragraph -split '\s+')) {
            if (-not $line) { $line = $word; continue }
            if (($line.Length + 1 + $word.Length) -le $maxChars) {
                $line += " $word"
            } else {
                $lines.Add($line)
                $line = $word
            }
        }
        if ($line) { $lines.Add($line) }
    }
    return ,$lines.ToArray()
}

function Add-Text([string]$value, [double]$x, [double]$y, [double]$width, [double]$height, [int]$maxChars, [double]$fontSize = 13, [string]$className = 'label') {
    $lines = @(Wrap-Text $value $maxChars)
    if ($lines.Count -eq 0) { return }
    $lineHeight = $fontSize * 1.18
    $startY = $y + ($height - (($lines.Count - 1) * $lineHeight)) / 2 + ($fontSize * 0.34)
    $parts.Add("<text class=`"$className`" x=`"$(Format-Number ($x + $width / 2))`" y=`"$(Format-Number $startY)`" text-anchor=`"middle`" font-size=`"$(Format-Number $fontSize)`">")
    for ($index = 0; $index -lt $lines.Count; $index++) {
        $dy = if ($index -eq 0) { '0' } else { Format-Number $lineHeight }
        $parts.Add("<tspan x=`"$(Format-Number ($x + $width / 2))`" dy=`"$dy`">$(Escape-Xml $lines[$index])</tspan>")
    }
    $parts.Add('</text>')
}

$definitions = $document.SelectSingleNode("/*[local-name()='definitions']")
$shapeNodes = $document.SelectNodes("//*[local-name()='BPMNShape']")
$edgeNodes = $document.SelectNodes("//*[local-name()='BPMNEdge']")
$bounds = [System.Collections.Generic.List[object]]::new()

foreach ($shape in $shapeNodes) {
    $box = $shape.SelectSingleNode("./*[local-name()='Bounds']")
    if (-not $box) { continue }
    $bounds.Add([pscustomobject]@{
        X = [double]$box.GetAttribute('x'); Y = [double]$box.GetAttribute('y')
        W = [double]$box.GetAttribute('width'); H = [double]$box.GetAttribute('height')
    })
}
foreach ($edge in $edgeNodes) {
    foreach ($point in $edge.SelectNodes("./*[local-name()='waypoint']")) {
        $bounds.Add([pscustomobject]@{ X = [double]$point.GetAttribute('x'); Y = [double]$point.GetAttribute('y'); W = 0; H = 0 })
    }
}
$left = [Math]::Max(0, (($bounds | Measure-Object X -Minimum).Minimum) - 24)
$top = [Math]::Max(0, (($bounds | Measure-Object Y -Minimum).Minimum) - 24)
$right = (($bounds | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum) + 24
$bottom = (($bounds | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum) + 24
$svgWidth = $right - $left
$svgHeight = $bottom - $top

$parts.Add("<svg xmlns=`"http://www.w3.org/2000/svg`" width=`"$(Format-Number $svgWidth)`" height=`"$(Format-Number $svgHeight)`" viewBox=`"$(Format-Number $left) $(Format-Number $top) $(Format-Number $svgWidth) $(Format-Number $svgHeight)`">")
$parts.Add('<defs><marker id="sequence-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="#263746"/></marker><marker id="message-arrow" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M1,1 L10,5 L1,9" fill="none" stroke="#526b7b" stroke-width="1.4"/></marker></defs>')
$parts.Add('<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/><style>.label{font-family:Segoe UI,Arial,sans-serif;fill:#1e2934}.edge-label{font-family:Segoe UI,Arial,sans-serif;fill:#304453}.lane-label{font-family:Segoe UI,Arial,sans-serif;font-weight:600;fill:#334b5a}.node{stroke:#314554;stroke-width:1.8}.edge{fill:none;stroke:#263746;stroke-width:1.7}.message{fill:none;stroke:#526b7b;stroke-width:1.5;stroke-dasharray:8 6}</style>')

# Participant and lane backgrounds are drawn first so that every flow node stays readable.
$laneIndex = 0
foreach ($shape in $shapeNodes) {
    $elementId = $shape.GetAttribute('bpmnElement')
    $element = $definitions.SelectSingleNode(".//*[@id='$elementId']")
    if (-not $element) { continue }
    $kind = $element.LocalName
    if ($kind -notin @('participant', 'lane')) { continue }
    $box = $shape.SelectSingleNode("./*[local-name()='Bounds']")
    $x = [double]$box.GetAttribute('x'); $y = [double]$box.GetAttribute('y')
    $w = [double]$box.GetAttribute('width'); $h = [double]$box.GetAttribute('height')
    $name = $element.GetAttribute('name')
    if ($kind -eq 'participant') {
        $fill = if ($elementId -eq 'Participant_CycleHospital') { '#ffffff' } else { '#f9fbfc' }
        $dash = if ($shape.GetAttribute('isExpanded') -eq 'false') { ' stroke-dasharray="7 5"' } else { '' }
        $parts.Add("<rect class=`"node`" x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" rx=`"2`" fill=`"$fill`"$dash/>")
        if ($name) { Add-Text $name ($x + 6) ($y + 4) ([Math]::Min(148, $w - 12)) ($h - 8) 20 12 'lane-label' }
    } else {
        $fill = if (($laneIndex % 2) -eq 0) { '#f8fafc' } else { '#f1f6f8' }
        $parts.Add("<rect x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" fill=`"$fill`" stroke=`"#c6d2da`" stroke-width=`"1`"/>")
        $labelX = $x + 7; $labelY = $y + 12
        $centerX = $labelX + 13; $centerY = $labelY + (($h - 24) / 2)
        $parts.Add("<text class=`"lane-label`" x=`"$(Format-Number $centerX)`" y=`"$(Format-Number $centerY)`" text-anchor=`"middle`" font-size=`"12`" transform=`"rotate(-90 $(Format-Number $centerX) $(Format-Number $centerY))`">$(Escape-Xml $name)</text>")
        $parts.Add("<line x1=`"$(Format-Number ($x + 38))`" y1=`"$(Format-Number $y)`" x2=`"$(Format-Number ($x + 38))`" y2=`"$(Format-Number ($y + $h))`" stroke=`"#c6d2da`" stroke-width=`"1`"/>")
        $laneIndex++
    }
}

# Sequence and message flows use the BPMN DI waypoints verbatim.
foreach ($edge in $edgeNodes) {
    $elementId = $edge.GetAttribute('bpmnElement')
    $element = $definitions.SelectSingleNode(".//*[@id='$elementId']")
    if (-not $element) { continue }
    $points = @($edge.SelectNodes("./*[local-name()='waypoint']"))
    if ($points.Count -lt 2) { continue }
    $pathParts = [System.Collections.Generic.List[string]]::new()
    for ($index = 0; $index -lt $points.Count; $index++) {
        $px = Format-Number ([double]$points[$index].GetAttribute('x'))
        $py = Format-Number ([double]$points[$index].GetAttribute('y'))
        $pathParts.Add("$(if ($index -eq 0) { 'M' } else { 'L' }) $px $py")
    }
    $isMessage = $element.LocalName -eq 'messageFlow'
    $className = if ($isMessage) { 'message' } else { 'edge' }
    $markerId = if ($isMessage) { 'message-arrow' } else { 'sequence-arrow' }
    $parts.Add("<path class=`"$className`" d=`"$($pathParts -join ' ')`" marker-end=`"url(#$markerId)`"/>")
    $edgeName = $element.GetAttribute('name')
    if ($edgeName) {
        $labelBox = $edge.SelectSingleNode("./*[local-name()='BPMNLabel']/*[local-name()='Bounds']")
        if ($labelBox) {
            Add-Text $edgeName ([double]$labelBox.GetAttribute('x')) ([double]$labelBox.GetAttribute('y')) ([double]$labelBox.GetAttribute('width')) ([double]$labelBox.GetAttribute('height')) 18 11 'edge-label'
        } else {
            $middle = $points[[Math]::Floor(($points.Count - 1) / 2)]
            Add-Text $edgeName ([double]$middle.GetAttribute('x') - 45) ([double]$middle.GetAttribute('y') - 20) 90 18 14 10 'edge-label'
        }
    }
}

# Flow nodes are rendered over the connectors.
foreach ($shape in $shapeNodes) {
    $elementId = $shape.GetAttribute('bpmnElement')
    $element = $definitions.SelectSingleNode(".//*[@id='$elementId']")
    if (-not $element) { continue }
    $kind = $element.LocalName
    if ($kind -in @('participant', 'lane')) { continue }
    $box = $shape.SelectSingleNode("./*[local-name()='Bounds']")
    if (-not $box) { continue }
    $x = [double]$box.GetAttribute('x'); $y = [double]$box.GetAttribute('y')
    $w = [double]$box.GetAttribute('width'); $h = [double]$box.GetAttribute('height')
    $name = $element.GetAttribute('name')
    switch -Wildcard ($kind) {
        '*Gateway' {
            $cx = $x + $w / 2; $cy = $y + $h / 2
            $points = "$(Format-Number $cx),$(Format-Number $y) $(Format-Number ($x + $w)),$(Format-Number $cy) $(Format-Number $cx),$(Format-Number ($y + $h)) $(Format-Number $x),$(Format-Number $cy)"
            $parts.Add("<polygon class=`"node`" points=`"$points`" fill=`"#fff7dc`"/>")
            $parts.Add("<path d=`"M $(Format-Number ($x + $w * 0.34)) $(Format-Number ($y + $h * 0.34)) L $(Format-Number ($x + $w * 0.66)) $(Format-Number ($y + $h * 0.66)) M $(Format-Number ($x + $w * 0.66)) $(Format-Number ($y + $h * 0.34)) L $(Format-Number ($x + $w * 0.34)) $(Format-Number ($y + $h * 0.66))`" stroke=`"#526374`" stroke-width=`"1.5`"/>")
        }
        '*StartEvent' {
            $parts.Add("<circle class=`"node`" cx=`"$(Format-Number ($x + $w / 2))`" cy=`"$(Format-Number ($y + $h / 2))`" r=`"$(Format-Number ($w / 2 - 2))`" fill=`"#ffffff`"/>")
        }
        '*EndEvent' {
            $parts.Add("<circle cx=`"$(Format-Number ($x + $w / 2))`" cy=`"$(Format-Number ($y + $h / 2))`" r=`"$(Format-Number ($w / 2 - 2))`" fill=`"#ffffff`" stroke=`"#314554`" stroke-width=`"3.5`"/>")
        }
        '*Task' {
            $fill = if ($kind -eq 'serviceTask') { '#e7f5ee' } else { '#eef5ff' }
            $parts.Add("<rect class=`"node`" x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" rx=`"8`" fill=`"$fill`"/>")
        }
        default {
            $parts.Add("<rect class=`"node`" x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" rx=`"4`" fill=`"#ffffff`"/>")
        }
    }
    $labelShape = $shape.SelectSingleNode("./*[local-name()='BPMNLabel']/*[local-name()='Bounds']")
    if ($labelShape) {
        Add-Text $name ([double]$labelShape.GetAttribute('x')) ([double]$labelShape.GetAttribute('y')) ([double]$labelShape.GetAttribute('width')) ([double]$labelShape.GetAttribute('height')) 24 11 'label'
    } elseif ($kind -match 'Gateway') {
        $labelWidth = [Math]::Max(88, [Math]::Min(160, ($name.Length * 7)))
        Add-Text $name ($x + $w / 2 - $labelWidth / 2) ($y - 27) $labelWidth 22 ([Math]::Floor($labelWidth / 7)) 11 'label'
    } else {
        Add-Text $name ($x + 5) ($y + 4) ($w - 10) ($h - 8) ([Math]::Floor(($w - 18) / 7)) 12 'label'
    }
}

$parts.Add('</svg>')
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.File]::WriteAllText($outputFullPath, ($parts -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
Write-Output "Rendered $outputFullPath"
