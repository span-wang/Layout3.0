# PH3-13A RAGFlow 隔离合同报告

`foundation-contract.v1.json` 由 `scripts/ragflow-contract-probe.ts` 自动生成，禁止手工伪造通过结果。

运行前必须显式提供三个环境变量：

```powershell
$env:RAGFLOW_BASE_URL = '<RAGFlow 服务地址>'
$env:RAGFLOW_API_KEY = '<合同测试专用 API Key>'
$env:RAGFLOW_CONTRACT_ALLOW_WRITE = 'PH3-13A_ISOLATED_WRITE'
npx tsx scripts/ragflow-contract-probe.ts
```

脚本只创建名称以 `layout3-ph3-13a-contract-` 开头的一次性数据集。所有远端变更都会核对本轮创建的数据集和文档 ID，并在 `finally` 中删除隔离数据集。

任一合同不满足时脚本以非零状态退出，但仍会生成脱敏报告。报告不会写入 API Key、服务地址或本机绝对路径。

`foundation-contract.v1.json` 保留 RAGFlow 0.25.0 的原始 15 项能力事实：13 项通过，两个 `document_ids + status` 联合检查仍然显示失败，禁止为了路线 A 手工改成通过。新增的 pending/active 精确 ID 两个独立通道必须都通过，且请求不能携带 `metadata_condition`。

用户确认路线 A 后，执行以下本地命令读取原始报告并生成机器决策：

```powershell
npm run ragflow:contract:route-a
```

生成的 `route-a-decision.v1.json` 必须满足：原始检查 15 项完整、路线 A 必需检查 11/11 通过、源文件 SHA-256 与身份完整、生产数据集未使用、唯一隔离前缀和显式写入守卫成立、隔离数据集已尝试并成功清理且删除后回读不存在、报告不含凭据和绝对路径。两个联合过滤失败只有在返回集合与本轮两份对抗文档精确一致时，才可识别为 RAGFlow 0.25.0 已知限制；未来版本若通过，会被记录为额外防御，不会替代精确 active `document_ids` 主门禁。
