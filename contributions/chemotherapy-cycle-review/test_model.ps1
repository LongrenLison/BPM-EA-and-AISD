param( # 声明脚本参数，让调用者可以指定待检查 BPMN 的路径。
  [string]$ModelPath = (Join-Path $PSScriptRoot 'chemotherapy-cycle-review-optimized.bpmn') # 默认检查当前目录中的最终 BPMN 文件。
)

$ErrorActionPreference = 'Stop' # 任意检查发生异常就停止，避免把错误当作通过。
[xml]$xml = Get-Content -Raw -LiteralPath $ModelPath # 将 BPMN 文件完整读入并解析为 XML。
$tests = [System.Collections.Generic.List[string]]::new() # 建立列表保存每一项通过的检查结果。
function Assert-That([bool]$condition, [string]$message) { # 统一执行断言并记录检查结果。
  if (-not $condition) { throw "FAIL: $message" } # 条件不成立时抛出失败信息并停止测试。
  $script:tests.Add("PASS: $message") # 条件成立时把通过信息加入总清单。
}

## 下面先检查 BPMN 的结构、任务表单绑定和安全分支设置。
$process = $xml.SelectSingleNode('//*[local-name()="process"]') # 找到流程主元素，后续用于核对流程属性。
Assert-That ($process.GetAttribute('isExecutable') -eq 'true') 'process is marked executable' # 确认该流程标记为可执行。
Assert-That ($xml.SelectNodes('//*[local-name()="taskDefinition"]').Count -eq 3) 'three service tasks have Zeebe job types' # 确认三个服务任务都定义了 Zeebe Job Type。
Assert-That ($xml.SelectNodes('//*[local-name()="conditionExpression"]').Count -ge 8) 'gateway branches have FEEL conditions' # 确认网关分支设置了足够的 FEEL 条件。
Assert-That ($xml.SelectNodes('//*[local-name()="process"]/*[local-name()="userTask"]/*[local-name()="extensionElements"]/*[local-name()="formDefinition"]').Count -eq 9) 'nine Camunda forms are linked to user tasks' # 确认共有九个 Camunda 表单绑定到人工任务。
$formlessTasks = @($xml.SelectNodes('//*[local-name()="process"]/*[local-name()="userTask"]') | Where-Object { -not $_.SelectSingleNode('./*[local-name()="extensionElements"]/*[local-name()="formDefinition"]') }) # 找出没有绑定表单的人工任务。
Assert-That ($formlessTasks.Count -eq 0) 'every user task has a linked Camunda form' # 确认每个用户任务都有表单。
Assert-That ($xml.SelectNodes('//*[local-name()="startEvent"]').Count -eq 1) 'one untyped start event avoids Camunda multiple-blank-start errors' # 确认流程只有一个开始事件。
Assert-That ($xml.SelectSingleNode('//*[@id="Flow_CycleStart"]').GetAttribute('targetRef') -eq 'Gateway_RequestType') 'the process start routes through request-type validation' # 确认开始后先判断请求类型。
Assert-That ($xml.SelectSingleNode('//*[@id="Gateway_RequestType"]').GetAttribute('default') -eq 'Flow_InvalidRequestType') 'unknown request types default to a no-change end' # 确认未知请求类型走安全结束分支。
Assert-That ($xml.SelectSingleNode('//*[@id="Task_FollowUpAuthorisation"]') -ne $null) 'urgent postponement has a follow-up authorisation task' # 确认紧急延期后有后续授权任务。
Assert-That ($xml.SelectSingleNode('//*[@id="Gateway_FollowUpAuthorised"]') -ne $null) 'follow-up decision has an explicit authorisation gateway' # 确认后续授权结果通过网关判断。
Assert-That ($xml.SelectSingleNode('//*[@id="End_FollowUpNotAuthorised"]') -ne $null) 'cancelled or unauthorised follow-up ends without schedule change' # 确认取消或未授权时有不改排程的结束点。
Assert-That ($xml.SelectSingleNode('//*[@id="Flow_UrgentFollowUp"]').GetAttribute('targetRef') -eq 'Task_FollowUpAuthorisation') 'urgent safety hold requires the separate follow-up task' # 确认紧急安全暂停必须进入后续授权任务。
Assert-That ($xml.SelectSingleNode('//*[@id="Flow_UrgentModification"]').GetAttribute('targetRef') -eq 'Gateway_FollowUpAuthorised') 'urgent modification cannot skip the follow-up authorisation gateway' # 确认紧急修改不能跳过后续授权判断。
Assert-That ($xml.SelectSingleNode('//*[@id="Task_RecordScheduleFailure"]') -ne $null) 'scheduling failure has a pending and retry task' # 确认排程失败时有记录和重试任务。
$flowNodes = @($xml.SelectNodes('//*[@id]') | Where-Object { $_.LocalName -in @('startEvent','endEvent','task','userTask','serviceTask','exclusiveGateway') }) # 收集所有主要流程节点。
$undocumented = @($flowNodes | Where-Object { -not $_.SelectSingleNode('./*[local-name()="documentation"]') }) # 找出缺少操作说明的流程节点。
Assert-That ($undocumented.Count -eq 0) 'every BPMN flow node has operating instructions in Documentation' # 确认所有节点都有说明。
$formDirectory = Join-Path (Split-Path $ModelPath) 'forms' # 根据 BPMN 文件位置找到 forms 子目录。
foreach ($formName in @('cycle-clinical-review.form','cycle-modification-authorisation.form','cycle-finance-review.form','urgent-postponement.form','urgent-follow-up-authorisation.form','cycle-results-retry.form','cycle-continuation-authorisation.form','planned-delay-plan.form','cycle-schedule-failure.form')) { # 依次检查九个任务表单。
  $formPath = Join-Path $formDirectory $formName # 拼出当前表单 JSON 的完整路径。
  $formObject = Get-Content -Raw -LiteralPath $formPath | ConvertFrom-Json # 读取并解析 JSON，检查文件本身是否有效。
  Assert-That ($formObject.id -and $formObject.components.Count -gt 0) "form schema is valid: $formName" # 确认表单有 ID 且包含组件。
}
$followUpForm = Get-Content -Raw -LiteralPath (Join-Path $formDirectory 'urgent-follow-up-authorisation.form') | ConvertFrom-Json # 单独读取紧急后续授权表单。
$followUpKeys = @($followUpForm.components | ForEach-Object { $_.key }) # 提取表单中所有字段的变量名。
Assert-That ($followUpKeys -contains 'followUpAuthoriser' -and $followUpKeys -contains 'followUpAuthorisedAt') 'urgent follow-up form records authoriser and authorisation time' # 确认记录了授权人和授权时间。
$workerPath = Join-Path (Split-Path $ModelPath) 'workers\chemotherapy-cycle-worker.mjs' # 定位模拟服务任务的 JavaScript Worker。
$workerText = Get-Content -Raw -LiteralPath $workerPath # 读取 Worker 源码，供下面核对 Job Type。
foreach ($jobType in @('clinical-results.request','chemotherapy.schedule-update','correspondence.notify-cycle-plan')) { # 逐一检查 Worker 需要处理的三种任务。
  Assert-That ($workerText.Contains($jobType)) "worker handler exists for $jobType" # 确认 Worker 中包含流程声明的每种任务类型。
}

$ids = @{} # 建立哈希表，记录已经出现过的 BPMN ID。
$duplicateIds = @() # 建立数组收集重复 ID。
foreach ($element in $xml.SelectNodes('//*[@id]')) { # 遍历所有带 ID 的 BPMN 元素，检查 ID 是否重复。
  if ($ids.ContainsKey($element.GetAttribute('id'))) { $duplicateIds += $element.GetAttribute('id') } # 如果 ID 已记录，就把它加入重复列表。
  $ids[$element.GetAttribute('id')] = $true # 标记当前 ID 已经检查过。
}
Assert-That ($duplicateIds.Count -eq 0) 'all BPMN IDs are unique' # 确认每个 BPMN 元素的 ID 都唯一。
$missingRefs = @() # 准备收集无法指向有效元素的引用。
foreach ($element in $xml.SelectNodes('//*[@sourceRef or @targetRef or @bpmnElement or @processRef or @attachedToRef]')) { # 遍历所有含流程引用的元素。
  foreach ($attribute in @('sourceRef','targetRef','bpmnElement','processRef','attachedToRef')) { # 检查所有常见的 BPMN 元素引用属性。
    if ($element.HasAttribute($attribute)) { # 只处理当前元素实际具有的属性。
      $value = $element.GetAttribute($attribute) # 读取引用目标的 ID。
      if ($value -and -not $ids.ContainsKey($value)) { $missingRefs += "$($element.GetAttribute('id')):$attribute=$value" } # 引用非空但目标不存在时记录错误。
    }
  }
}
Assert-That ($missingRefs.Count -eq 0) 'all source, target, participant and diagram references resolve' # 确认顺序流、参与者和图形引用都能找到目标。

function Test-FeelExpression([string]$expression, [hashtable]$variables) { # 用简化规则在本地测试 BPMN 的 FEEL 条件。
  $parts = ($expression.Trim() -replace '^=', '') -split '\s+and\s+' # 去掉开头等号，并按 and 拆分多个判断条件。
  foreach ($part in $parts) { # 逐个验证由 and 分开的子条件。
    if ($part -notmatch '^\s*(\w+)\s*=\s*(true|false|"[^"]+")\s*$') { throw "Unsupported test expression: $expression" } # 只接受本测试器支持的“变量 = 布尔值/文字”格式。
    $key = $Matches[1] # 取出左侧变量名。
    $expectedRaw = $Matches[2] # 取出条件要求的值。
    if (-not $variables.ContainsKey($key)) { return $false } # 输入变量未提供时，条件视为不成立。
    if ($expectedRaw -eq 'true' -or $expectedRaw -eq 'false') { # 如果目标值是布尔值，就按布尔类型比较。
      $expected = $expectedRaw -eq 'true' # 把 true/false 文本转换成布尔值。
      if ([bool]$variables[$key] -ne $expected) { return $false } # 任意一个布尔条件不匹配就返回 false。
    } else { # 非布尔值按字符串文本进行比较。
      $expected = $expectedRaw.Trim('"') # 去掉字符串两侧的引号，取得实际比较文本。
      if ([string]$variables[$key] -ne $expected) { return $false } # 任意一个文本条件不匹配就返回 false。
    }
  }
  return $true # 所有子条件都匹配时，整体条件成立。
}

function Resolve-GatewayFlow([string]$gatewayId, [hashtable]$variables) { # 根据输入变量模拟网关会选择哪条顺序流。
  $gateway = $xml.SelectSingleNode("//*[@id='$gatewayId']") # 找到当前网关定义。
  $outgoing = @($xml.SelectNodes('//*[local-name()="sequenceFlow"]') | Where-Object { $_.GetAttribute('sourceRef') -eq $gatewayId }) # 找到从该网关发出的所有连线。
  foreach ($flow in $outgoing) { # 依次尝试该网关的每条出口连线。
    $condition = $flow.SelectSingleNode('./*[local-name()="conditionExpression"]') # 读取当前连线上的条件表达式。
    if ($condition -and (Test-FeelExpression $condition.InnerText $variables)) { return $flow } # 找到首条成立的条件流后立即返回。
  }
  $defaultId = $gateway.GetAttribute('default') # 没有条件匹配时，读取网关声明的默认流 ID。
  return $outgoing | Where-Object { $_.GetAttribute('id') -eq $defaultId } | Select-Object -First 1 # 返回默认流，模拟流程的兜底路径。
}

$normal = @( # 准备若干正常情况，每项包含网关 ID、输入变量和预期流 ID。
  @('Gateway_RequestType', @{ requestType = 'cycleReview' }, 'Flow_RequestCycleReview'), # 正常场景：周期复核请求走周期复核分支。
  @('Gateway_ResultsAvailable', @{ resultsAvailable = $true }, 'Flow_ResultsReady'), # 正常场景：结果齐全后进入临床审查。
  @('Gateway_CycleDecision', @{ cycleDecision = 'continue' }, 'Flow_ContinueCycle'), # 正常场景：继续治疗时走继续周期分支。
  @('Gateway_ScheduleUpdated', @{ scheduleUpdated = $true }, 'Flow_ScheduleSucceeded'), # 正常场景：排程更新成功后走成功分支。
  @('Gateway_FinancialImpact', @{ financialImpact = $false }, 'Flow_NoFinancialImpact') # 正常场景：无财务影响时走通知路径。
)
foreach ($case in $normal) { # 逐项运行上面准备的正常路径检查。
  $resolved = Resolve-GatewayFlow $case[0] $case[1] # 根据该场景变量计算实际选中的连线。
  Assert-That ($resolved -and $resolved.GetAttribute('id') -eq $case[2]) "normal scenario: $($case[0]) selects $($case[2])" # 比较实际路径与预期路径。
}
$modificationIntake = Resolve-GatewayFlow 'Gateway_RequestType' @{ requestType = 'treatmentModification' } # 模拟正式治疗修改申请入口。
Assert-That ($modificationIntake.GetAttribute('id') -eq 'Flow_RequestTreatmentModification') 'modification intake enters the formal authorisation path' # 确认修改申请进入正式授权流程。
$invalidIntake = Resolve-GatewayFlow 'Gateway_RequestType' @{ requestType = 'unknown' } # 模拟缺失或错误的请求类型。
Assert-That ($invalidIntake.GetAttribute('id') -eq 'Flow_InvalidRequestType' -and $invalidIntake.GetAttribute('targetRef') -eq 'End_InvalidRequestType') 'missing or unknown request type ends without changing the schedule' # 确认未知请求安全结束且不改排期。
$normalTarget = $xml.SelectSingleNode('//*[@id="Flow_NoFinancialImpact"]') # 找到财务无影响时使用的流程连线。
Assert-That ($normalTarget.GetAttribute('targetRef') -eq 'Task_NotifyPatient') 'normal path proceeds to patient notification after no financial impact' # 确认正常流程接下来会通知患者。

$missingResults = Resolve-GatewayFlow 'Gateway_ResultsAvailable' @{ resultsAvailable = $false } # 模拟检查结果尚未齐全的情况。
Assert-That ($missingResults.GetAttribute('id') -eq 'Flow_ResultsMissing' -and $missingResults.GetAttribute('targetRef') -eq 'Task_RecordResultRetry') 'exception scenario: missing results remain pending and create a controlled retry task' # 确认结果缺失会进入待处理和受控重试。
$retry = $xml.SelectSingleNode('//*[@id="Flow_RetryResults"]') # 找到重试后返回的流程连线。
Assert-That ($retry.GetAttribute('targetRef') -eq 'Task_RequestResults') 'retry returns to the same correlated request task' # 确认重试会再次请求检查结果。

$change = Resolve-GatewayFlow 'Gateway_CycleDecision' @{ cycleDecision = 'change' } # 模拟医生决定申请变更治疗。
Assert-That ($change.GetAttribute('id') -eq 'Flow_ChangeTreatment') 'exception scenario: change decision enters formal modification path' # 确认变更决定会进入正式修改审核。
$followUpConfirmed = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'confirm'; followUpAuthorised = $true } # 模拟紧急延期后被确认并完成授权。
Assert-That ($followUpConfirmed.GetAttribute('id') -eq 'Flow_FollowUpConfirmed' -and $followUpConfirmed.GetAttribute('targetRef') -eq 'Task_CreateFormalModification') 'urgent follow-up confirmation proceeds to formal modification' # 确认确认路径进入正式修改。
$followUpAmended = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'amend'; followUpAuthorised = $true } # 模拟紧急延期后修改方案并完成授权。
Assert-That ($followUpAmended.GetAttribute('id') -eq 'Flow_FollowUpAmended' -and $followUpAmended.GetAttribute('targetRef') -eq 'Task_CreateFormalModification') 'urgent follow-up amendment proceeds to formal modification' # 确认修订路径进入正式修改。
$followUpCancelled = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'cancel'; followUpAuthorised = $true } # 模拟取消后续治疗安排。
Assert-That ($followUpCancelled.GetAttribute('id') -eq 'Flow_FollowUpNotAuthorised' -and $followUpCancelled.GetAttribute('targetRef') -eq 'End_FollowUpNotAuthorised') 'cancelled urgent follow-up retains hold and blocks schedule change' # 确认取消时保留安全暂停且不改排程。
$followUpIncomplete = Resolve-GatewayFlow 'Gateway_FollowUpAuthorised' @{ followUpDecision = 'confirm'; followUpAuthorised = $false } # 模拟虽然选择确认但授权信息不完整。
Assert-That ($followUpIncomplete.GetAttribute('id') -eq 'Flow_FollowUpNotAuthorised' -and $followUpIncomplete.GetAttribute('targetRef') -eq 'End_FollowUpNotAuthorised') 'incomplete urgent follow-up cannot reach schedule update' # 确认未授权完整时不能进入排程更新。
$followUpEndOutgoing = @($xml.SelectNodes('//*[local-name()="sequenceFlow"]') | Where-Object { $_.GetAttribute('sourceRef') -eq 'End_FollowUpNotAuthorised' }) # 查找未授权结束点是否还有流出路径。
Assert-That ($followUpEndOutgoing.Count -eq 0) 'unauthorised follow-up end has no path back to schedule update' # 确认未授权结束后没有路径可以改排程。
$unauthorised = Resolve-GatewayFlow 'Gateway_ModificationAuthorised' @{ formalRequest = $false; modificationAuthorised = $false } # 模拟没有正式申请且未获授权的修改。
Assert-That ($unauthorised.GetAttribute('id') -eq 'Flow_NotAuthorised' -and $unauthorised.GetAttribute('targetRef') -eq 'End_AwaitingAuthorisation') 'exception scenario: informal change is rejected and schedule stays unchanged' # 确认非正式修改被拒绝且排程不变。
$schedule = $xml.SelectSingleNode('//*[@id="Flow_AuthorisedChange"]') # 找到已授权修改通往排程更新的连线。
Assert-That ($schedule.GetAttribute('targetRef') -eq 'Task_UpdateTreatmentSchedule') 'only a formal, authorised modification can reach schedule update' # 确认只有正式授权后才会更新排程。

$tests | ForEach-Object { Write-Output $_ } # 逐条打印所有通过的检查结果。
Write-Output "Total model-level checks: $($tests.Count) passed; 0 failed." # 汇总显示通过数量和失败数量。
Write-Output 'Camunda engine end-to-end execution is not covered by this model-level check.' # 提醒这只是静态模型检查，不等于真实引擎端到端测试。
