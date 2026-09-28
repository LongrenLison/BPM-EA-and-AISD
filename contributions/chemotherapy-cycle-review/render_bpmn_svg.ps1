param( # 声明输入文件和输出文件路径参数。
    [string]$InputPath = (Join-Path $PSScriptRoot 'chemotherapy-cycle-review-optimized.bpmn'), # 默认读取当前脚本目录中的最终 BPMN 文件。
    [string]$OutputPath = (Join-Path $PSScriptRoot 'chemotherapy-cycle-review-final.svg') # 默认把生成的 SVG 保存到当前脚本目录。
)

$ErrorActionPreference = 'Stop' # 遇到未处理错误时立即停止，避免输出不完整的图。
[xml]$document = Get-Content -LiteralPath $InputPath -Raw # 以 XML 方式读取整个 BPMN 文件。
$invariant = [Globalization.CultureInfo]::InvariantCulture # 使用固定数字格式，保证 SVG 坐标的小数点始终为句点。
$parts = [System.Collections.Generic.List[string]]::new() # 建立字符串列表，用来逐段收集 SVG 内容。

function Format-Number([double]$value) { # 把坐标数字转成最多保留两位小数的文本。
    return $value.ToString('0.##', $invariant) # 使用固定区域格式输出数字，避免本地小数逗号影响 SVG。
}

function Escape-Xml([string]$value) { # 对文本中的 XML 特殊字符进行转义。
    return [System.Security.SecurityElement]::Escape($value) # 防止 &, < 等字符破坏生成的 SVG/XML。
}

function Wrap-Text([string]$value, [int]$maxChars) { # 按给定最大字符数把标签文字换行。
    if ([string]::IsNullOrWhiteSpace($value)) { return @() } # 空文本不生成任何文字行。
    $maxChars = [Math]::Max(8, $maxChars) # 限制最小行宽，避免过早把文字拆得太碎。
    $lines = [System.Collections.Generic.List[string]]::new() # 创建结果列表，逐行存放换行后的文字。
    foreach ($paragraph in ($value -split "`r?`n")) { # 先按原有换行符保留段落边界。
        $line = '' # 开始构造当前这一行。
        foreach ($word in ($paragraph -split '\s+')) { # 按空白拆成词，避免从词中间截断。
            if (-not $line) { $line = $word; continue } # 当前行为空时先放入第一个词。
            if (($line.Length + 1 + $word.Length) -le $maxChars) { # 判断新词加到当前行后是否仍在允许宽度内。
                $line += " $word" # 当前词放得下，就接到这一行末尾。
            } else { # 放不下时，先结束当前行，再开启新行。
                $lines.Add($line) # 当前行放不下时，先保存已经完成的一行。
                $line = $word # 再用当前词开始新的一行。
            }
        }
        if ($line) { $lines.Add($line) } # 保存段落最后尚未提交的一行。
    }
    return ,$lines.ToArray() # 返回所有换行后的文字行。
}

function Add-Text([string]$value, [double]$x, [double]$y, [double]$width, [double]$height, [int]$maxChars, [double]$fontSize = 13, [string]$className = 'label') { # 在指定区域居中绘制一段 SVG 文字。
    $lines = @(Wrap-Text $value $maxChars) # 先根据区域宽度把文字拆成多行。
    if ($lines.Count -eq 0) { return } # 没有文字时无需生成 SVG 元素。
    $lineHeight = $fontSize * 1.18 # 根据字号计算相邻文字行之间的距离。
    $startY = $y + ($height - (($lines.Count - 1) * $lineHeight)) / 2 + ($fontSize * 0.34) # 计算文字组的垂直起点，使文字在区域内居中。
    $parts.Add("<text class=`"$className`" x=`"$(Format-Number ($x + $width / 2))`" y=`"$(Format-Number $startY)`" text-anchor=`"middle`" font-size=`"$(Format-Number $fontSize)`">") # 添加 SVG 文本容器并设置中心对齐。
    for ($index = 0; $index -lt $lines.Count; $index++) { # 逐行把换好行的文字添加到 SVG。
        $dy = if ($index -eq 0) { '0' } else { Format-Number $lineHeight } # 第一行不额外下移，后续行按行距递进。
        $parts.Add("<tspan x=`"$(Format-Number ($x + $width / 2))`" dy=`"$dy`">$(Escape-Xml $lines[$index])</tspan>") # 添加一行转义后的文字。
    }
    $parts.Add('</text>') # 关闭 SVG 文本容器。
}

$definitions = $document.SelectSingleNode("/*[local-name()='definitions']") # 找到 BPMN 定义根节点，供后续查找流程元素。
$shapeNodes = $document.SelectNodes("//*[local-name()='BPMNShape']") # 读取图中每个节点、泳道和参与者的绘图位置。
$edgeNodes = $document.SelectNodes("//*[local-name()='BPMNEdge']") # 读取每条连线的绘图路径信息。
$bounds = [System.Collections.Generic.List[object]]::new() # 收集全部图形边界，用于计算 SVG 画布大小。

foreach ($shape in $shapeNodes) { # 遍历所有 BPMN 图形，收集矩形范围。
    $box = $shape.SelectSingleNode("./*[local-name()='Bounds']") # 获取当前图形的矩形边界。
    if (-not $box) { continue } # 没有坐标信息的图形无法参与画布尺寸计算。
    $bounds.Add([pscustomobject]@{ # 将每个图形的四边界坐标整理成对象。
        X = [double]$box.GetAttribute('x'); Y = [double]$box.GetAttribute('y') # 记录图形左上角的横纵坐标。
        W = [double]$box.GetAttribute('width'); H = [double]$box.GetAttribute('height') # 记录图形的宽度和高度。
    })
}
foreach ($edge in $edgeNodes) { # 遍历所有连线，收集其折点坐标。
    foreach ($point in $edge.SelectNodes("./*[local-name()='waypoint']")) { # 把连线的每个折点也计入画布边界。
        $bounds.Add([pscustomobject]@{ X = [double]$point.GetAttribute('x'); Y = [double]$point.GetAttribute('y'); W = 0; H = 0 }) # 折点本身无宽高，只记录其横纵位置。
    }
}
$left = [Math]::Max(0, (($bounds | Measure-Object X -Minimum).Minimum) - 24) # 计算画布左边界并留出 24 像素边距。
$top = [Math]::Max(0, (($bounds | Measure-Object Y -Minimum).Minimum) - 24) # 计算画布上边界并留出边距。
$right = (($bounds | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum) + 24 # 计算最右侧图形的位置并加边距。
$bottom = (($bounds | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum) + 24 # 计算最下侧图形的位置并加边距。
$svgWidth = $right - $left # 根据左右边界得到画布宽度。
$svgHeight = $bottom - $top # 根据上下边界得到画布高度。

$parts.Add("<svg xmlns=`"http://www.w3.org/2000/svg`" width=`"$(Format-Number $svgWidth)`" height=`"$(Format-Number $svgHeight)`" viewBox=`"$(Format-Number $left) $(Format-Number $top) $(Format-Number $svgWidth) $(Format-Number $svgHeight)`">") # 写入 SVG 根元素及画布坐标范围。
$parts.Add('<defs><marker id="sequence-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L9,4 L0,8 Z" fill="#263746"/></marker><marker id="message-arrow" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M1,1 L10,5 L1,9" fill="none" stroke="#526b7b" stroke-width="1.4"/></marker></defs>') # 定义顺序流和消息流的箭头样式。
$parts.Add('<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/><style>.label{font-family:Segoe UI,Arial,sans-serif;fill:#1e2934}.edge-label{font-family:Segoe UI,Arial,sans-serif;fill:#304453}.lane-label{font-family:Segoe UI,Arial,sans-serif;font-weight:600;fill:#334b5a}.node{stroke:#314554;stroke-width:1.8}.edge{fill:none;stroke:#263746;stroke-width:1.7}.message{fill:none;stroke:#526b7b;stroke-width:1.5;stroke-dasharray:8 6}</style>') # 设置 SVG 白色背景、文字字体和节点/连线样式。

# 先画参与者和泳道背景，最后再覆盖流程节点，避免节点被背景遮住。
$laneIndex = 0 # 用于交替设置泳道底色。
foreach ($shape in $shapeNodes) { # 第一遍绘制参与者和泳道背景。
    $elementId = $shape.GetAttribute('bpmnElement') # 从图形引用中取出对应 BPMN 元素的 ID。
    $element = $definitions.SelectSingleNode(".//*[@id='$elementId']") # 按 ID 找到流程中的实际元素。
    if (-not $element) { continue } # 找不到实际元素时跳过该图形。
    $kind = $element.LocalName # 记录元素种类，例如 participant 或 lane。
    if ($kind -notin @('participant', 'lane')) { continue } # 这里只绘制参与者和泳道背景。
    $box = $shape.SelectSingleNode("./*[local-name()='Bounds']") # 读取当前背景矩形的边界元素。
    $x = [double]$box.GetAttribute('x'); $y = [double]$box.GetAttribute('y') # 取左上角坐标。
    $w = [double]$box.GetAttribute('width'); $h = [double]$box.GetAttribute('height') # 取矩形的宽和高。
    $name = $element.GetAttribute('name') # 获取参与者或泳道标题文字。
    if ($kind -eq 'participant') { # 按参与者类型绘制整个参与者区域。
        $fill = if ($elementId -eq 'Participant_CycleHospital') { '#ffffff' } else { '#f9fbfc' } # 为主流程和其他参与者选择背景色。
        $dash = if ($shape.GetAttribute('isExpanded') -eq 'false') { ' stroke-dasharray="7 5"' } else { '' } # 折叠参与者用虚线边框表示。
        $parts.Add("<rect class=`"node`" x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" rx=`"2`" fill=`"$fill`"$dash/>") # 添加参与者矩形及其边框。
        if ($name) { Add-Text $name ($x + 6) ($y + 4) ([Math]::Min(148, $w - 12)) ($h - 8) 20 12 'lane-label' } # 有标题时在参与者区域绘制标题。
    } else { # 当前元素是泳道，绘制泳道底色、标签和分隔线。
        $fill = if (($laneIndex % 2) -eq 0) { '#f8fafc' } else { '#f1f6f8' } # 交替使用浅色底纹，便于区分泳道。
        $parts.Add("<rect x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" fill=`"$fill`" stroke=`"#c6d2da`" stroke-width=`"1`"/>") # 添加泳道背景矩形。
        $labelX = $x + 7; $labelY = $y + 12 # 计算泳道竖排标题的起始位置。
        $centerX = $labelX + 13; $centerY = $labelY + (($h - 24) / 2) # 计算竖排标题旋转的中心点。
        $parts.Add("<text class=`"lane-label`" x=`"$(Format-Number $centerX)`" y=`"$(Format-Number $centerY)`" text-anchor=`"middle`" font-size=`"12`" transform=`"rotate(-90 $(Format-Number $centerX) $(Format-Number $centerY))`">$(Escape-Xml $name)</text>") # 以旋转 90 度的方式绘制泳道名称。
        $parts.Add("<line x1=`"$(Format-Number ($x + 38))`" y1=`"$(Format-Number $y)`" x2=`"$(Format-Number ($x + 38))`" y2=`"$(Format-Number ($y + $h))`" stroke=`"#c6d2da`" stroke-width=`"1`"/>") # 在泳道标签旁画分隔线。
        $laneIndex++ # 更新泳道序号，以便下一条泳道切换底色。
    }
}

# 按 BPMN DI 中记录的折点绘制顺序流和消息流。
foreach ($edge in $edgeNodes) { # 第二遍绘制流程连线。
    $elementId = $edge.GetAttribute('bpmnElement') # 读取当前连线引用的 BPMN 元素 ID。
    $element = $definitions.SelectSingleNode(".//*[@id='$elementId']") # 通过 ID 获取顺序流或消息流元素。
    if (-not $element) { continue } # 无对应元素的图形连线跳过。
    $points = @($edge.SelectNodes("./*[local-name()='waypoint']")) # 获取连线经过的所有坐标点。
    if ($points.Count -lt 2) { continue } # 少于两个点无法构成连线。
    $pathParts = [System.Collections.Generic.List[string]]::new() # 逐点构建 SVG 路径命令。
    for ($index = 0; $index -lt $points.Count; $index++) { # 按顺序把每个折点拼成路径指令。
        $px = Format-Number ([double]$points[$index].GetAttribute('x')) # 读取并格式化当前折点横坐标。
        $py = Format-Number ([double]$points[$index].GetAttribute('y')) # 读取并格式化当前折点纵坐标。
        $pathParts.Add("$(if ($index -eq 0) { 'M' } else { 'L' }) $px $py") # 首点移动到起点，其余点用直线连接。
    }
    $isMessage = $element.LocalName -eq 'messageFlow' # 判断当前连线是否属于参与者之间的消息流。
    $className = if ($isMessage) { 'message' } else { 'edge' } # 按消息流或顺序流选择不同的线条样式。
    $markerId = if ($isMessage) { 'message-arrow' } else { 'sequence-arrow' } # 选择对应的箭头图案。
    $parts.Add("<path class=`"$className`" d=`"$($pathParts -join ' ')`" marker-end=`"url(#$markerId)`"/>") # 写出连线路径并添加末端箭头。
    $edgeName = $element.GetAttribute('name') # 读取连线上的条件/说明标签。
    if ($edgeName) { # 有连线名称时，再为其绘制标签。
        $labelBox = $edge.SelectSingleNode("./*[local-name()='BPMNLabel']/*[local-name()='Bounds']") # 查找 BPMN 里指定的标签边界。
        if ($labelBox) { # BPMN 中有指定标签位置时，优先使用该位置。
            Add-Text $edgeName ([double]$labelBox.GetAttribute('x')) ([double]$labelBox.GetAttribute('y')) ([double]$labelBox.GetAttribute('width')) ([double]$labelBox.GetAttribute('height')) 18 11 'edge-label' # 在 BPMN 指定位置绘制连线标签。
        } else { # 没有指定标签位置时，把标签放到连线中间附近。
            $middle = $points[[Math]::Floor(($points.Count - 1) / 2)] # 选择中间折点作为标签参考位置。
            Add-Text $edgeName ([double]$middle.GetAttribute('x') - 45) ([double]$middle.GetAttribute('y') - 20) 90 18 14 10 'edge-label' # 没有指定位置时在中间折点附近绘制标签。
        }
    }
}

# 在所有背景和连线之后绘制流程节点，保证节点显示在最上层。
foreach ($shape in $shapeNodes) { # 第三遍在背景和连线上方绘制流程节点。
    $elementId = $shape.GetAttribute('bpmnElement') # 读取当前图形所代表的 BPMN 元素 ID。
    $element = $definitions.SelectSingleNode(".//*[@id='$elementId']") # 查找流程定义中的对应元素。
    if (-not $element) { continue } # 未匹配到流程元素时跳过。
    $kind = $element.LocalName # 保存元素类型，后续根据类型选择绘制方式。
    if ($kind -in @('participant', 'lane')) { continue } # 背景类型已在前面绘制，这里不重复处理。
    $box = $shape.SelectSingleNode("./*[local-name()='Bounds']") # 读取当前节点的坐标和尺寸。
    if (-not $box) { continue } # 没有坐标信息的节点无法绘制。
    $x = [double]$box.GetAttribute('x'); $y = [double]$box.GetAttribute('y') # 读取节点左上角的横纵坐标。
    $w = [double]$box.GetAttribute('width'); $h = [double]$box.GetAttribute('height') # 读取节点的宽度和高度。
    $name = $element.GetAttribute('name') # 获取流程节点显示名称。
    switch -Wildcard ($kind) { # 按 BPMN 元素类型选择圆形、菱形或矩形等图形。
        '*Gateway' { # 网关用菱形表示，并在中心画叉号以表示条件分支。
            $cx = $x + $w / 2; $cy = $y + $h / 2 # 计算网关菱形中心点。
            $points = "$(Format-Number $cx),$(Format-Number $y) $(Format-Number ($x + $w)),$(Format-Number $cy) $(Format-Number $cx),$(Format-Number ($y + $h)) $(Format-Number $x),$(Format-Number $cy)" # 根据四个顶点计算菱形轮廓。
            $parts.Add("<polygon class=`"node`" points=`"$points`" fill=`"#fff7dc`"/>") # 绘制浅黄色网关菱形。
            $parts.Add("<path d=`"M $(Format-Number ($x + $w * 0.34)) $(Format-Number ($y + $h * 0.34)) L $(Format-Number ($x + $w * 0.66)) $(Format-Number ($y + $h * 0.66)) M $(Format-Number ($x + $w * 0.66)) $(Format-Number ($y + $h * 0.34)) L $(Format-Number ($x + $w * 0.34)) $(Format-Number ($y + $h * 0.66))`" stroke=`"#526374`" stroke-width=`"1.5`"/>") # 在网关中心加叉号，表示互斥选择。
        }
        '*StartEvent' { # 开始事件用细边圆形表示。
            $parts.Add("<circle class=`"node`" cx=`"$(Format-Number ($x + $w / 2))`" cy=`"$(Format-Number ($y + $h / 2))`" r=`"$(Format-Number ($w / 2 - 2))`" fill=`"#ffffff`"/>") # 绘制开始事件圆圈。
        }
        '*EndEvent' { # 结束事件用较粗圆边表示。
            $parts.Add("<circle cx=`"$(Format-Number ($x + $w / 2))`" cy=`"$(Format-Number ($y + $h / 2))`" r=`"$(Format-Number ($w / 2 - 2))`" fill=`"#ffffff`" stroke=`"#314554`" stroke-width=`"3.5`"/>") # 用粗边框绘制结束事件圆圈。
        }
        '*Task' { # 人工任务和服务任务都使用圆角矩形。
            $fill = if ($kind -eq 'serviceTask') { '#e7f5ee' } else { '#eef5ff' } # 服务任务使用绿色，其他任务使用蓝色。
            $parts.Add("<rect class=`"node`" x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" rx=`"8`" fill=`"$fill`"/>") # 绘制圆角任务矩形并使用对应底色。
        }
        default { # 其他 BPMN 元素使用普通白色矩形作为后备显示。
            $parts.Add("<rect class=`"node`" x=`"$(Format-Number $x)`" y=`"$(Format-Number $y)`" width=`"$(Format-Number $w)`" height=`"$(Format-Number $h)`" rx=`"4`" fill=`"#ffffff`"/>") # 对其他未单独处理的节点使用白色矩形。
        }
    }
    $labelShape = $shape.SelectSingleNode("./*[local-name()='BPMNLabel']/*[local-name()='Bounds']") # 查找 BPMN 图中明确设置的标签位置。
    if ($labelShape) { # 有指定标签边界时按该边界绘制文字。
        Add-Text $name ([double]$labelShape.GetAttribute('x')) ([double]$labelShape.GetAttribute('y')) ([double]$labelShape.GetAttribute('width')) ([double]$labelShape.GetAttribute('height')) 24 11 'label' # 按 BPMN 给出的标签边界绘制节点名称。
    } elseif ($kind -match 'Gateway') { # 网关标签若无指定位置，则放在菱形上方。
        $labelWidth = [Math]::Max(88, [Math]::Min(160, ($name.Length * 7))) # 根据标题长度估算标签宽度，并限制最小/最大值。
        Add-Text $name ($x + $w / 2 - $labelWidth / 2) ($y - 27) $labelWidth 22 ([Math]::Floor($labelWidth / 7)) 11 'label' # 把网关名称显示在网关上方。
    } else { # 其他节点将标签放在节点矩形内部。
        Add-Text $name ($x + 5) ($y + 4) ($w - 10) ($h - 8) ([Math]::Floor(($w - 18) / 7)) 12 'label' # 将其他流程节点名称绘制在节点内部。
    }
}

$parts.Add('</svg>') # 写入 SVG 文档结束标签。
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath) # 将输出路径转换成绝对路径。
[System.IO.File]::WriteAllText($outputFullPath, ($parts -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false)) # 按 UTF-8 无 BOM 格式写出完整 SVG。
Write-Output "Rendered $outputFullPath" # 报告生成文件的完整位置。
