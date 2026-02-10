# MCP Cloud Bridge

将本地 [Pieces OS](https://pieces.app/) 的 MCP 服务安全暴露到云端，让远程 AI Agent 通过 REST API 访问你的长期记忆。

## 架构

```
[远程 Agent] --REST/Bearer--> [Cloud Relay (Hono)] --WebSocket--> [Local Bridge] --HTTP--> [Pieces OS]
```

- **Cloud Relay** — Hono 服务，部署于 Cloudflare Workers，转发请求
- **Local Bridge** — npm CLI 工具，连接本地 Pieces MCP 到云端
- **认证** — API Key + Machine ID 双 hash，Salt 仅存云端

## 快速开始

### 1. 启动 Cloud Relay

```bash
cd cloud
npm install
# 创建 .dev.vars 文件，设置 HASH_SALT
echo "HASH_SALT=your-secret-salt" > .dev.vars
npx wrangler dev
# → http://localhost:8787
```

### 2. 初始化 Local Bridge

```bash
cd bridge
npm install
npx tsx src/index.ts init --cloud http://localhost:8787
# 输出你的 API Key（仅显示一次，请妥善保管！）
# 输出你的 Node ID
```

### 3. 启动 Bridge

```bash
npx tsx src/index.ts start
# ✅ Connected to cloud relay
# 👂 Waiting for remote requests...
```

### 4. 远程调用

```bash
# 查看可用工具
curl http://localhost:8787/mcp/{NODE_ID}/tools \
  -H "Authorization: Bearer {YOUR_API_KEY}"

# 查询长期记忆
curl -X POST http://localhost:8787/mcp/{NODE_ID}/call \
  -H "Authorization: Bearer {YOUR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "ask_pieces_ltm",
      "arguments": {
        "question": "今天我做了什么",
        "chat_llm": "gpt-4o"
      }
    }
  }'
```

## API 参考

| 端点 | 方法 | 认证 | 说明 |
|---|---|---|---|
| `/api/hash` | POST | 无 | 返回 `SHA256(value + salt)` |
| `/ws/bridge` | WS | nodeId + keyHash | Bridge 上线注册 |
| `/mcp/:nodeId/status` | GET | Bearer | 检查 Bridge 是否在线 |
| `/mcp/:nodeId/tools` | GET | Bearer | 获取可用 MCP 工具列表 |
| `/mcp/:nodeId/call` | POST | Bearer | 调用 MCP 工具 |
| `/health` | GET | 无 | 健康检查 |

## 认证流程

```
首次注册:
  1. Bridge 生成随机 API Key
  2. Bridge 调用 /api/hash 获取 key_hash 和 node_id (machine ID hash)
  3. key_hash + node_id 保存到 ~/.mcp-bridge/config.json
  4. 原始 Key 显示给用户（仅一次）

每次上线:
  Bridge 通过 WebSocket 发送 node_id + key_hash → Cloud 注册路由

远程调用:
  Agent 发送 Bearer {原始Key} → Cloud 计算 hash → 与注册的 key_hash 比对
```

## CLI 命令

```bash
mcp-bridge init --cloud <url>    # 首次配置，生成 Key
mcp-bridge start                  # 连接云端
mcp-bridge rotate-key             # 轮换 API Key
mcp-bridge status                 # 查看当前配置
```

## 密钥轮换

```bash
npx tsx src/index.ts rotate-key
# 生成新 Key，旧 Key 立即失效
# 需要重启 bridge 生效
```

## 项目结构

```
mcp_proxy/
├── cloud/                      # Hono Cloud Relay
│   ├── src/
│   │   ├── index.ts            # 路由入口
│   │   ├── types.ts            # 类型定义
│   │   └── services/
│   │       ├── crypto.ts       # SHA-256 + salt
│   │       └── bridge-relay.ts # Durable Object
│   ├── wrangler.jsonc          # CF Workers 配置
│   └── .dev.vars               # 本地 salt (gitignore)
│
└── bridge/                     # Local Bridge CLI
    ├── src/
    │   ├── index.ts            # CLI 入口 (commander)
    │   ├── bridge.ts           # WebSocket + 请求转发
    │   ├── mcp-client.ts       # Streamable HTTP 客户端
    │   ├── identity.ts         # node-machine-id 处理
    │   ├── config.ts           # ~/.mcp-bridge/config.json
    │   └── e2e-test.ts         # 集成测试
    └── package.json
```

## 部署到 Cloudflare Workers

```bash
cd cloud

# 设置 salt secret
npx wrangler secret put HASH_SALT

# 部署
npm run deploy
```

## 运行测试

```bash
# 确保 Cloud Relay 和 Pieces OS 都在运行
cd bridge
npx tsx src/e2e-test.ts
```

## 安全说明

- Salt 仅存储在云端，本地和远程客户端均不可见
- 云端只存 hash，永远不知道原始 Key
- Machine ID 经 hash 处理，云端不知道真实设备信息
- 所有 `/mcp/*` 端点均需 Bearer 认证
- 生产环境务必使用 HTTPS/WSS
