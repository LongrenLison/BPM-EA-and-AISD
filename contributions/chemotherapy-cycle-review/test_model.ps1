param(
  [string]$ModelPath = (Join-Path $PSScriptRoot 'chemotherapy-cycle-review-optimized.bpmn')
)

$ErrorActionPreference = 'Stop'
[xml]$xml = Get-Content -Raw -LiteralPath $ModelPath
$tests = [System.Collections.Generic.List[string]]::new()
function Assert-That([bool]$condition, [string]$message) {
  if (-not $condition) { throw "FAIL: $message" }
  $script:tests.Add("PASS: $message")
}

$process = $xml.SelectSingleNode('//*[local-name()="process"]')
Assert-That ($process.GetAttribute('isExecutable') -eq 'true') 'process is marked executable'
Assert-That ($xml.SelectNodes('//*[local-name()="taskDefinition"]').Count -eq 3) 'three service tasks have Zeebe job types'
Assert-That ($xml.SelectNodes('//*[local-name()="conditionExpression"]').Count -ge 8) 'gateway branches have FEEL conditions'
Assert-That ($xml.SelectNodes('//*[local-name()="process"]/*[local-name()="userTask"]/*[local-name()="extensionElements"]/*[local-name()="formDefinition"]').Count -eq 9) 'nine Camunda forms are linked to user tasks'
$formlessTasks = @($xml.SelectNodes('//*[local-name()="process"]/*[local-name()="userTask"]') | Where-Object { -not $_.SelectSingleNode('./*[local-name()="extensionElements"]/*[local-name()="formDefinition"]') })
Assert-That ($formlessTasks.Count -eq 0) 'every user task has a linked Camunda form'
Assert-That ($xml.SelectNodes('//*[local-name()="startEvent"]').Count -eq 1) 'one untyped start event avoids Camunda multiple-blank-start errors'
Assert-That ($xml.SelectSingleNode('//*[@id="Flow_CycleStart"]').GetAttribute('targetRef') -eq 'Gateway_RequestType') 'the process start routes through request-type validation'
Assert-That ($xml.SelectSingleNode('//*[@id="Gateway_RequestType"]').GetAttribute('default') -eq 'Flow_InvalidRequestType') 'unknown request types default to a no-change end'
Assert-That ($xml.SelectSingleNode('//*[@id="Task_FollowUpAuthorisation"]') -ne $null) 'urgent postponement has a follow-up authorisation task'
Assert-That ($xml.SelectSingleNode('//*[@id="Gateway_FollowUpAuthorised"]') -ne $null) 'follow-up decision has an explicit authorisation gateway'
Assert-That ($xml.SelectSingleNode('//*[@id="End_FollowUpNotAuthorised"]') -ne $null) 'cancelled or unauthorised follow-up ends without schedule change'
Assert-That ($xml.SelectSingleNode('//*[@id="Flow_UrgentFollowUp"]').GetAttribute('targetRef') -eq 'Task_FollowUpAuthorisation') 'urgent safety hold requires the separate follow-up task'
Assert-That ($xml.SelectSingleNode('//*[@id="Flow_UrgentModification"]').GetAttribute('targetRef') -eq 'Gateway_FollowUpAuthorised') 'urgent modification cannot skip the follow-up authorisation gateway'
Assert-That ($xml.SelectSingleNode('//*[@id="Task_RecordScheduleFailure"]') -ne $null) 'scheduling failure has a pending and retry task'
$flowNodes = @($xml.SelectNodes('//*[@id]') | Where-Object { $_.LocalName -in @('startEvent','endEvent','task','userTask','serviceTask','exclusiveGateway') })
$undocumented = @($flowNodes | Where-Object { -not $_.SelectSingleNode('./*[local-name()="documentation"]') })
Assert-That ($undocumented.Count -eq 0) 'every BPMN flow node has operating instructions in Documentation'
$formDirectory = Join-Path (Split-Path $ModelPath) 'forms'
foreach ($formName in @('cycle-clinical-review.form','cycle-modification-authorisation.form','cycle-finance-review.form','urgent-postponement.form','urgent-follow-up-authorisation.form','cycle-results-retry.form','cycle-continuation-authorisation.form','planned-delay-plan.form','cycle-schedule-failure.form')) {
  $formPath = Join-Path $formDirectory $formName
  $formObject = Get-Content -Raw -LiteralPath $formPath | ConvertFrom-Json
  Assert-That ($formObject.id -and $formObject.components.Count -gt 0) "form schema is valid: $formName"
}
$followUpForm = Get-Content -Raw -LiteralPath (Join-Path $formDirectory 'urgent-follow-up-authorisation.form') | ConvertFrom-Json
$followUpKeys = @($followUpForm.components | ForEach-Object { $_.key })
Assert-That ($followUpKeys -contains 'followUpAuthoriser' -and $followUpKeys -contains 'followUpAuthorisedAt') 'urgent follow-up form records authoriser and authorisation time'
$workerPath = Join-Path (Split-Path $ModelPath) 'workers\chemotherapy-cycle-worker.mjs'
$workerText = Get-Content -Raw -LiteralPath $workerPath
foreach ($jobType in @('clinical-results.request','chemotherapy.schedule-update','correspondence.notify-cycle-plan')) {
  Assert-That ($workerText.Contains($jobType)) "worker handler exists for $jobType"
}

$ids = @{}
$duplicateIds = @()
foreach ($element in $xml.SelectNodes('//*[@id]')) {
  if ($ids.ContainsKey($element.GetAttribute('id'))) { $duplicateIds += $element.GetAttribute('id') }
  $ids[$element.GetAttribute('id')] = $true
}
Assert-That ($duplicateIds.Count -eq 0) 'all BPMN IDs are unique'
$missingRefs = @()
foreach ($element in $xml.SelectNodes('//*[@sourceRef or @targetRef or @bpmnElement or @processRef or @attachedToRef]')) {
  foreach ($attribute in @('sourceRef','targetRef','bpmnElement','processRef','attachedToRef')) {
    if ($element.HasAttribute($attribute)) {
      $value = $element.GetAttribute($attribute)
      if ($value -and -not $ids.ContainsKey($value)) { $missingRefs += "$($element.GetAttribute('id')):$attribute=$value" }
    }
  }
}
Assert-That ($missingRefs.Count -eq 0) 'all source, target, participant and diagram references resolve'

function Test-FeelExpression([string]$expression, [hashtable]$variables) {
  $parts = ($expression.Trim() -replace '^=', '') -split '\s+and\s+'
  foreach ($part in $parts) {
    if ($part -notmatch '^\s*(\w+)\s*=\s*(true|false|"[^"]+")\s*$') { throw "Unsupported test expression: $expression" }
    $key = $Matches[1]
    $expectedRaw = $Matches[2]
    if (-not $variables.ContainsKey($key)) { return $false }
    if ($expectedRaw -eq 'true' -or $expectedRaw -eq 'false') {
      $expected = $expectedRaw -eq 'true'
      if ([bool]$variables[$key] -ne $expected) { return $false }
    } else {
      $expected = $expectedRaw.Trim('"')
      if ([string]$variables[$key] -ne $expected) { return $false }
    }
  }
  return $true
}

function Resolve-GatewayFlow([string]$gatewayId, [hashtable]$variables) {
  $gateway = $xml.SelectSingleNode("//*[@id='$gatewayId']")
  $outgoing = @($xml.SelectNodes('//*[local-name()="sequenceFlow"]') | Where-Object { $_.GetAttribute('sourceRef') -eq $gatewayId })
  foreach ($flow in $outgoing) {
    $condition = $flow.SelectSingleNode('./*[local-name()="conditionExpression"]')
    if ($condition -and (Test-FeelExpression $condition.InnerText $variables)) { return $flow }
  }
  $defaultId = $gateway.GetAttribute('default')
  return $outgoing | Where-Object { $_.GetAttribute('id') -eq $defaultId } | Select-Object -First 1
}

$normal = @(
  @('Gateway_RequestType', @{ requestType = 'cycleReview' }, 'Flow_RequestCycleReview'),
  @('Gateway_ResultsAvailable', @{ resultsAvailable = $true }, 'Flow_ResultsReady'),
  @('Gateway_CycleDecision', @{ cycleDecision = 'continue' }, 'Flow_ContinueCycle'),
  @('Gateway_ScheduleUpdated', @{ scheduleUpdated = $true }, 'Flow_ScheduleSucceeded'),
  @('Gateway_FinancialImpact', @{ financialImpact = $false }, 'Flow_NoFinancialImpact')
)
foreach ($case in $normal) {
  $resolved = Resolve-GatewayFlow $case[0] $case[1]
  Assert-That ($resolved -and $resolved.GetAttribute('id') -eq $case[2]) "normal scenario: $($case[0]) selects $($case[2])"
}
$modificationIntake = Resolve-GatewayFlow 'Gateway_RequestType' @{ requestType = 'treatmentModification' }
Assert-That ($modificationIntake.GetAttribute('id') -eq 'Flow_RequestTreatmentModification') 'modification intake enters the formal authorisation path'
$invalidIntake = Resolve-GatewayFlow 'Gateway_RequestType' @{ requestType = 'unknown' }
Assert-That ($invalidIntake.GetAttribute('id') -eq 'Flow_InvalidRequestType' -and $invalidIntake.GetAttribute('targetRef') -eq 'End_InvalidRequestType') 'missing or unknown request type ends without changing the schedule'
$normalTarget = $xml.SelectSingleNode('//*[@id="Flow_NoFinancialImpact"]')
Assert-That ($normalTarget.GetAttribute('targetRef') -eq 'Task_NotifyPatient') 'normal path proceeds to patient notification after no financial impact'

$missingResults = Resolve-GatewayFlow 'Gateway_ResultsAvailable' @{ resultsAvailable = $false }
Assert-That ($missingResults.GetAttribute('id') -eq 'Flow_ResultsMissing' -and $missingResults.GetAttribute('targetRef') -eq 'Task_RecordResultRetry') 'exception scenario: missing results remain pending and create a controlled retry task'
$retry = $xml.SelectSingleNode('//*[@id="Flow_RetryResults"]')
Assert-That ($retry.GetAttribute('targetRef') -eq 'Task_RequestResults') 'retry returns to the same correlated request task'

$change = Resolve-GatewayFlow 'Gateway_CycleDecision' @{ cycleDecision = 'change' }
Assert-That ($change.GetAttribute('id') -eq 'Flow_ChangeTreatment') 'exception scenario: change decision enters formal modification path'
$followUpConfirmed = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'confirm'; followUpAuthorised = $true }
Assert-That ($followUpConfirmed.GetAttribute('id') -eq 'Flow_FollowUpConfirmed' -and $followUpConfirmed.GetAttribute('targetRef') -eq 'Task_CreateFormalModification') 'urgent follow-up confirmation proceeds to formal modification'
$followUpAmended = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'amend'; followUpAuthorised = $true }
Assert-That ($followUpAmended.GetAttribute('id') -eq 'Flow_FollowUpAmended' -and $followUpAmended.GetAttribute('targetRef') -eq 'Task_CreateFormalModification') 'urgent follow-up amendment proceeds to formal modification'
$followUpCancelled = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'cancel'; followUpAuthorised = $true }
Assert-That ($followUpCancelled.GetAttribute('id') -eq 'Flow_FollowUpNotAuthorised' -and $followUpCancelled.GetAttribute('targetRef') -eq 'End_FollowUpNotAuthorised') 'cancelled urgent follow-up retains hold and blocks schedule change'
$followUpIncomplete = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'confirm'; followUpAuthorised = $false }
Assert-That ($followUpIncomplete.GetAttribute('id') -eq 'Flow_FollowUpNotAuthorised' -and $followUpIncomplete.GetAttribute('targetRef') -eq 'End_FollowUpNotAuthorised') 'incomplete urgent follow-up cannot reach schedule update'
$followUpEndOutgoing = @($xml.SelectNodes('//*[local-name()="sequenceFlow"]') | Where-Object { $_.GetAttribute('sourceRef') -eq 'End_FollowUpNotAuthorised' })
Assert-That ($followUpEndOutgoing.Count -eq 0) 'unauthorised follow-up end has no path back to schedule update'
$unauthorised = Resolve-GatewayFlow 'Gateway_ModificationAuthorised' @{ formalRequest = $false; modificationAuthorised = $false }
Assert-That ($unauthorised.GetAttribute('id') -eq 'Flow_NotAuthorised' -and $unauthorised.GetAttribute('targetRef') -eq 'End_AwaitingAuthorisation') 'exception scenario: informal change is rejected and schedule stays unchanged'
$schedule = $xml.SelectSingleNode('//*[@id="Flow_AuthorisedChange"]')
Assert-That ($schedule.GetAttribute('targetRef') -eq 'Task_UpdateTreatmentSchedule') 'only a formal, authorised modification can reach schedule update'

$tests | ForEach-Object { Write-Output $_ }
Write-Output "Total model-level checks: $($tests.Count) passed; 0 failed."
Write-Output 'Camunda engine end-to-end execution is not covered by this model-level check.'
