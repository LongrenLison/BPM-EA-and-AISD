param(
    [string]$BaseUrl = 'http://localhost:8080/v2',
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$model = Join-Path $root '16-core-patient-enquiries-standalone.bpmn'
[xml]$xml = Get-Content -LiteralPath $model -Raw
$ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
$ns.AddNamespace('bpmn', 'http://www.omg.org/spec/BPMN/20100524/MODEL')
$ns.AddNamespace('zeebe', 'http://camunda.org/schema/zeebe/1.0')
$ns.AddNamespace('bpmndi', 'http://www.omg.org/spec/BPMN/20100524/DI')
$process = $xml.SelectSingleNode('//bpmn:process[@isExecutable="true"]', $ns)
if (-not $process -or $process.id -ne 'Hospital_Enquiry_Standalone') {
    throw 'Expected exactly the standalone patient enquiry process.'
}
if (@($xml.SelectNodes('//bpmn:process[@isExecutable="true"]', $ns)).Count -ne 1) {
    throw 'Only one executable BPMN process should be deployed from this package.'
}
$external = $xml.SelectSingleNode('//bpmn:participant[@id="Participant_ExternalEnquiry"]', $ns)
$messageFlow = $xml.SelectSingleNode('//bpmn:messageFlow[@id="MessageFlow_ExternalEnquiry_Received"]', $ns)
$messageStart = $xml.SelectSingleNode('//bpmn:startEvent[@id="Q_Start"]/bpmn:messageEventDefinition', $ns)
$message = $xml.SelectSingleNode('//bpmn:message[@id="Q_Start_Message"]', $ns)
if (-not $external -or $external.processRef -or -not $messageFlow -or -not $messageStart -or -not $message) {
    throw 'External black-box participant or message start is missing.'
}
if ($messageFlow.sourceRef -ne $external.id -or $messageFlow.targetRef -ne 'Q_Start' -or
    $messageFlow.messageRef -ne $message.id -or $messageStart.messageRef -ne $message.id -or
    $message.name -ne 'Patient enquiry received (standalone)') {
    throw 'External message flow does not match the message start event.'
}
if (-not $xml.SelectSingleNode('//bpmndi:BPMNShape[@bpmnElement="Participant_ExternalEnquiry"]', $ns) -or
    -not $xml.SelectSingleNode('//bpmndi:BPMNEdge[@bpmnElement="MessageFlow_ExternalEnquiry_Received"]', $ns)) {
    throw 'External participant or message flow has no diagram layout.'
}
$jobTypes = @($process.SelectNodes('.//zeebe:taskDefinition', $ns) | ForEach-Object { $_.type } | Sort-Object -Unique)
$expectedJobTypes = @('hospital.enquiry.audit.record', 'hospital.enquiry.initialize')
if (($jobTypes -join '|') -ne ($expectedJobTypes -join '|')) {
    throw "Unexpected job types: $($jobTypes -join ', ')"
}
$formIds = @($process.SelectNodes('.//zeebe:formDefinition', $ns) | ForEach-Object {
    if ($_.bindingType -ne 'deployment') { throw "Form $($_.formId) must use deployment binding" }
    $_.formId
} | Sort-Object -Unique)
$expectedForms = @('h-enquiry-intake', 'h-enquiry-response', 'h-enquiry-triage')
if (($formIds -join '|') -ne ($expectedForms -join '|')) {
    throw "Unexpected form IDs: $($formIds -join ', ')"
}
$resources = @($model)
foreach ($id in $formIds) {
    $path = Join-Path $root "forms\$id.form"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing form: $id" }
    $form = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($form.id -ne $id) { throw "Form ID mismatch in $path" }
    $resources += $path
}
$summary = [ordered]@{ processId=$process.id; messageName=$message.name; messageFlow=$messageFlow.id; jobTypes=$jobTypes; formIds=$formIds; resources=$resources }
if ($ValidateOnly) {
    $summary | ConvertTo-Json -Depth 5
    return
}

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(2)
$multipart = [System.Net.Http.MultipartFormDataContent]::new()
try {
    foreach ($path in $resources) {
        $part = [System.Net.Http.ByteArrayContent]::new([System.IO.File]::ReadAllBytes($path))
        $part.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
        $multipart.Add($part, 'resources', [System.IO.Path]::GetFileName($path))
    }
    $response = $client.PostAsync(($BaseUrl.TrimEnd('/') + '/deployments'), $multipart).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw "Deployment failed (HTTP $([int]$response.StatusCode)): $body" }
    $summary.deployment = $body | ConvertFrom-Json
    $summary.deployedAt = (Get-Date).ToUniversalTime().ToString('o')
    $summary | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $root 'deployment-last.json') -Encoding utf8
    $summary.deployment | ConvertTo-Json -Depth 12
}
finally {
    $multipart.Dispose()
    $client.Dispose()
}
