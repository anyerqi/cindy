# Auto-review / Jev 纯客户端接入

## 交付状态

本包是客户端源码增量和受校验的补丁生成器，不是已提交的仓库版本。未修改服务端或网关，未写回 GitHub，未 commit。

**原生审阅分支和引擎缓存失效接线尚未完成，不应把此包作为完整功能直接发布。**

## 目标与设置

设置的个性化分区新增 Auto-review 卡片，可选原有模式或 Jev。默认为原有模式，不修改聊天模型、网关别名或原有降级链。

选择 Jev 时显示 API key 密码输入框。首次必须提供密钥；已配置时留空保留旧值。已存密钥不回显，只返回是否存在。“恢复默认”保留密钥；“删除密钥并恢复默认”才清除密钥。保存不代表已通过真实 API 连通性检查。

配置按当前账号隔离，复用本机 safeStorage。密钥是 Main-only 键，通用前端存储接口不能读取、覆盖或删除。设置 JSON 只含模式和变更标识，不含密钥。

## 直连流程

```text
Settings UI -> dedicated preload API -> trusted Main IPC
                                      -> owner-scoped settings / safeStorage

Cindy review callback -> provider router
                     -> default: existing model chain
                     -> jev: Main outboundFetch -> TypeSafe /v1/systemone
```

客户端主进程直接请求 `https://api.typesafe.ai/v1/systemone`，使用 `jev-1.13.0` 和 TypeSafe 原生 `state + questions` 协议。不使用 Chat Completions 兼容假设。出网复用现有系统代理通道，密钥不下发给 Agent 子进程。

有效的 `block` 和 `ask` 直接结束判断，不换模型寻找 `allow`。选中 Jev 后不静默回退到网关。短暂故障最多尝试两次，每次 6 秒；失败交回原有人工确认流程。超时包括响应体读取，不跟随重定向，错误不携带原始响应体或密钥。

## 上下文审计

当前 Host 已提供用户意图、具体动作、请求者身份、目录范围和最多三条前序被阻止动作。获批计划与澄清答案已会并入用户意图。

关键限制是上游用户意图仅有 2,000 字符预算：超长消息会整条省略，历史也可能被舍弃。本实现保留省略标记，不将“未看到限制”当成“无限制”。Jev 不能恢复上游已经丢弃的文本。

Jev 分支从同一 Host 请求取完整目录路径，不沿用原提示词的 512 字符路径压缩。不新增全量聊天、文件正文、附件、工具结果、Memory 或 Skill 外发。状态预算为 24,576 字节，超限不静默截断。

明确目标和授权的操作可以使用现有证据判断。“发送那个”、“执行刚才的方案”或效果不明的脚本可能缺少关键证据；本次未实现上游按需补取证据。

同次请求并行判断 `decision` 和 `context`，前者选三态结果，后者判断是否缺少影响本次判断的证据。这不是独立的事实验证。两个问题的概率门槛暂为 0.90，未经实测校准，不是 90% 正确率保证。不确定或证据不足的 `allow` 转为普通 `ask`。

## 未完成的原生路径

官方 Claude OAuth 的部分路径使用 SDK 原生 Auto，不经过 Cindy 审阅回调。Codex 也有 `approvalsReviewer: auto_review` 分支。需在引擎层将显式 Jev 选择接入客户端审阅路由，并保持原沙箱和权限边界。

原有引擎会缓存审阅结果，仅取消新 router 的等待不能作废已缓存的结论。需给缓存和执行边界加入 provider、密钥和 owner 变更代次的失效接线。本包仅完成了新 router 层的取消和过期结果检查。

## 验证

- 纯模块 TypeScript strict 检查与编译通过。
- 154 项离线测试通过，无跳过。包含设置读写、账号竞态、前端控制器、协议校验和源码片段变换测试。
- 13 个新增 TypeScript/TSX 文件通过语法检查。这不是 Electron/React 全项目类型检查。
- 五种语言文案键一致，未在实际软件中验证界面、明暗主题或多平台行为。
- 未调用真实 Jev API，未验证中文授权判断准确率。
- 未在完整 checkout 中生成或应用补丁。未运行仓库必需的 `pnpm test:unit:related` 和受影响包 typecheck，因此没有 commit。

仓库基线、Git blob 校验值、官方接口来源见 `SOURCE_MANIFEST.json`。命令和目录说明见 `README.md`。
