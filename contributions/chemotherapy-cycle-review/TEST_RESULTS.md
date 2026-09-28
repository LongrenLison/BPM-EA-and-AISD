# 测试结果

测试日期：2026-09-28

## 已执行的模型级测试

运行 `test_model.ps1` 后，48 项模型级检查通过，0 项失败。检查内容包括 Camunda 8 可执行标记、Zeebe Worker 类型、九个任务表单的绑定和 JSON 结构、流程节点操作说明、ID 唯一性、BPMN/DI 引用完整性、入口分类、正常路径、缺少结果重试、非正式修改拒绝，以及紧急延期后续授权的确认、修改、取消和授权不完整路径。

| 场景 | 测试输入与检查点 | 结果 |
|---|---|---|
| 正常路径 | 结果可用 → 临床决定 `continue` → 排期成功 → 无财务影响 → 通知患者 | 通过（模型级路由检查；确认了各网关选择和通知路径） |
| 异常路径 | 临床决定 `change`，但 `formalRequest=false`、`modificationAuthorised=false` | 通过（模型级路由检查；进入拒绝结束事件，不进入排期） |
| 紧急延期授权异常 | 后续授权取消或授权不完整 | 通过（模型级路由检查；保留紧急暂停，不进入修改或排期） |
| 无效入口异常 | `requestType` 缺失或未知 | 通过（模型级路由检查；安全结束且不改排期） |
| 缺少结果 | `resultsAvailable=false` | 通过（模型级路由检查；进入待处理/重试任务，并可回到同一结果请求） |
| Worker 语法 | 对 `chemotherapy-cycle-worker.mjs` 运行 Node.js 语法检查 | 通过 |
| Camunda Modeler 校验 | 在 Camunda Modeler 5.51.1 中打开最终 BPMN 并检查 Problems | 通过（0 errors，0 warnings） |
| 流程图 SVG | 检查 SVG XML，并逐一核对 BPMN 流程节点名称 | 通过（25 个命名节点均有对应图中文字） |

## 尚待执行

Camunda 引擎端到端测试：**待测试**。本次检查时本机 `localhost:8080` 与 `localhost:26500` 均没有监听，因此尚未部署 BPMN，也没有在 Tasklist 中真实启动流程实例。上表的“通过”仅代表模型级条件和路由检查，不代表 Camunda 引擎已运行通过。
