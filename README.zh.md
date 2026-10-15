# pi-agent-workflow

一个 pi(pi-coding-agent)扩展:把 Agent 实际发生的事变成可以检查的东西——以用户轮次为入口,展示每轮真实发生的**模型请求**(`system` / `messages` / `tools`)、**模型响应**和**工具调用**,呈现为清晰的执行链路。移植自 DeepSeek Harness 插件 [dsh-plugin-agent-workflow](https://github.com/xuanyuanzhifeng/dsh-plugin-agent-workflow)。

用途:观察与逆向 Agent(包括 pi 自己)的行为——到底向模型发了什么、模型回了什么、工具被如何调用。和 DSH 原版一样,它是**只读观察者**:不会向模型请求增加任何消息、提示词或工具。

English: [README.md](README.md)

## 主要功能

- **按用户轮次浏览**——本进程内实时记录的运行,加上重启后由持久化摘要重建的暗色"会话历史"分组。
- **逐调用的执行链路**——每次模型调用展示 Token 输入/输出、缓存读取/写入、工具数、耗时与成败标记。
- **完整请求检查**——`System` / `Messages` / `Tools` / `Raw` 标签页按供应商原始 wire 形状展示(Anthropic 顶层 `system`、OpenAI 系首条 system 消息,以及未加工的完整 payload 快照),可折叠 JSON 树逐级展开。
- **响应检查**——用量、stopReason、耗时、thinking 块数、回复文本,以及完整消息 JSON。
- **工具执行状态**——运行中/完成/失败,调用参数、结果预览与脱敏后的完整结果、耗时、嵌套调用来源(codemode/MCP)。
- **Token 与缓存统计**——输入、缓存读、缓存写、输出(含推理子集),逐调用与逐轮次汇总。
- **键盘驱动、三级导航**——轮次 → 调用 → 详情;`esc` 逐级返回,`q` 任意退出。

## 安装

需要 Node.js 22.19+(pi 自身的要求;本扩展是纯 TypeScript,由 pi 内置的 `jiti` 直接加载,无需编译)。

把整个目录复制到 pi 的用户扩展目录:

```sh
git clone https://github.com/BassYes/pi-agent-workflow.git
mkdir -p ~/.pi/agent/extensions
cp -r pi-agent-workflow ~/.pi/agent/extensions/
```

开发调试时直接加载单份文件:

```sh
pi --extension ./pi-agent-workflow/index.ts
```

重启 pi 后,状态栏出现 `wf ●` 表示详细记录已开启。

### 本地类型检查(可选)

```sh
# 在仓库根目录;临时 junction 用于解析类型,检查完删除
mkdir -p node_modules/@earendil-works node_modules/@types
mklink /J "node_modules\@earendil-works\pi-coding-agent" "<全局npm目录>\@earendil-works\pi-coding-agent"
mklink /J "node_modules\@earendil-works\pi-tui"          "<全局npm目录>\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-tui"
mklink /J "node_modules\@types"                          "<全局npm目录>\@earendil-works\pi-coding-agent\node_modules\@types"
npx -y -p typescript@5.9.3 tsc --noEmit -p tsconfig.json
rm -rf node_modules
```

`node test-smoke.mjs` 可运行纯逻辑冒烟测试,不需要启动 pi。

## 使用

| 命令 | 作用 |
| --- | --- |
| `/workflow` | 打开查看器(交互模式) |
| `/workflow on` / `off` | 开关新轮次的详细记录(默认开) |
| `/workflow status` | 查看记录状态与已详细记录的轮数 |
| `/workflow clear` | 清空本进程内存中的详细数据(会话摘要条目保留) |

### 查看器按键

运行列表 → 模型调用列表 → 调用详情,三级导航:

- `↑/↓` 或 `j/k` 移动;`Enter` 深入;`←`/`Esc` 返回;`q` 退出
- 详情页 `1`–`6`(或 `[` / `]`)切换:System / Messages / Tools / Raw / 响应 / 工具调用
- 树内 `↑/↓` 移动光标,`Enter` 展开/折叠节点,`pageUp/pageDown` 翻页,`g`/`G` 顶部/底部
- `e` 全部展开,`c` 全部折叠,`,`/`.` 切换上一个/下一个工具调用

## 数据来源

- **详细数据(仅本进程内存)**:`before_provider_request` 捕获真实请求 payload 快照(单个请求超过 2 MB 只保留结构计数;全部原文累计预算约 128 MB,超出后按最旧轮次驱逐);`message_end` 捕获响应(用量、stopReason、耗时);`tool_execution_*` 捕获工具调用(参数、结果、状态、耗时)。重启后这些原文消失。
- **会话摘要(持久)**:每轮结束向会话文件写入一条紧凑的 custom entry(模型、Token/缓存用量、工具清单、耗时)。重启后 `/workflow` 仍能看到这些轮次的统计(不含 payload 原文)。
- 系统提示词、工具定义、响应与工具结果均来自 pi 已有记录;扩展不向模型请求注入任何内容。

## 已知限制

- payload 原文只保存在内存中,有单请求(2 MB)与总量(约 128 MB)上限。
- 终端查看器为键盘驱动的列表导航,而非 DSH 插件的双栏网页布局。
- 重建历史时按 `turnIndex` 连续性近似分组,极端会话编辑后分组可能有偏差。
- 覆盖层按固定行数渲染,过矮的终端可能被裁剪。

## License

[MIT](LICENSE)。概念与数据模型移植自 [dsh-plugin-agent-workflow](https://github.com/xuanyuanzhifeng/dsh-plugin-agent-workflow)(MIT);本实现面向 pi。
