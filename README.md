# Remote Agent 远程代理插件

为 OpenClaw 提供远程设备管理能力的插件，支持Token 认证、命令推送和实时状态监控。

---

## 📋 目录

1. [插件概述](#插件概述)
2. [核心原理](#核心原理)
3. [功能列表](#功能列表)
4. [安装部署](#安装部署)
5. [配置说明](#配置说明)
6. [工具使用](#工具使用)
7. [客户端配置](#客户端配置)
8. [通信协议](#通信协议)
9. [故障排除](#故障排除)

---

## 插件概述

### 是什么？

Remote Agent 是一个 OpenClaw 服务端插件，配合 `claw-agent-client-rs` 客户端使用，实现对远程设备的控制和管理。

### 能做什么？

- 🖥️ **远程执行命令** - 在远程设备上执行 Shell 命令
- 📊 **获取系统信息** - 查看远程设备的主机名、操作系统、CPU、内存等
- 📁 **文件管理** - 列出远程设备的文件和目录
- 🌐 **浏览器控制** - 在远程设备上打开网页
- 📱 **多设备管理** - 同时管理多台远程设备

### 适用场景

- 远程服务器管理
- 家庭/办公室电脑远程控制
- 自动化运维任务
- 跨平台设备统一管理

---

## 核心原理

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenClaw 网关                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Remote Agent 插件                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │   │
│  │  │ WebSocket   │  │ Unix Socket │  │   Tools     │ │   │
│  │  │   Server    │  │   Server    │  │  Registry   │ │   │
│  │  │  (8765端口)  │  │  (实时事件)  │  │  (AI工具)   │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │   │
│  └─────────┼────────────────┼────────────────┼────────┘   │
└────────────┼────────────────┼────────────────┼────────────┘
             │                │                │
             │ WebSocket      │ Unix Socket    │ AI 调用
             │                │                │
┌────────────┴───────┐  ┌─────┴──────┐  ┌─────┴──────┐
│   远程客户端 A     │  │  监控脚本   │  │   AI 助手   │
│   (台式机/Windows) │  │  (事件订阅) │  │  (命令执行) │
└────────────────────┘  └────────────┘  └────────────┘

┌────────────────────┐
│   远程客户端 B     │
│   (笔记本/macOS)   │
└────────────────────┘
```

### 认证机制

1. **单一 Token**：服务端配置一个共享 Token，所有客户端使用相同 Token 进行认证
2. **自动注册**：客户端连接时只要 Token 校验通过，即可自动注册客户端 ID（agent_id）
3. **唯一在线**：同一客户端 ID 只能有一个在线连接，如果已在线则拒绝新连接
4. **持久化存储**：客户端信息保存在 `~/.openclaw/claw-remote-agent-plugin.json`

### 工作流程

1. **生成 Token**：使用工具生成服务器认证 Token
2. **配置服务端**：在 `openclaw.json` 中配置 Token
3. **配置客户端**：在客户端 `agent.yml` 中配置相同的 Token 和自己的 ID
4. **客户端连接**：客户端启动后，通过 WebSocket 连接到服务端 8765 端口
5. **身份认证**：客户端发送 agent_id 和 token 进行认证
6. **命令执行**：服务端通过 AI 工具或 Unix Socket 发送命令，客户端执行后返回结果

### 关键技术点

| 组件 | 技术 | 说明 |
|------|------|------|
| WebSocket 服务 | ws 库 | 客户端长连接，支持双向通信 |
| Unix Socket | net 模块 | 本地进程间通信，实时事件推送 |
| Token 认证 | 单一共享 Token | 所有客户端使用相同 Token |
| 持久化存储 | JSON 文件 | 客户端信息自动保存 |

---

## 功能列表

### 服务端工具

| 工具名称 | 中文标签 | 功能描述 |
|----------|----------|----------|
| `remote_agent.generate_token` | 生成服务器令牌 | 生成服务器使用的认证 Token |
| `remote_agent.server_status` | 服务器状态 | 查看服务器运行状态 |
| `remote_agent.send_command` | 发送命令 | 向指定设备发送任意命令 |
| `remote_agent.shell_exec` | 执行Shell命令 | 在远程设备上执行命令 |
| `remote_agent.get_system_info` | 获取系统信息 | 获取设备的系统信息 |
| `remote_agent.disconnect_agent` | 断开代理连接 | 强制断开指定设备的连接 |

### 客户端支持的命令

| 命令 | 说明 | 参数 |
|------|------|------|
| `system.info` | 获取系统信息 | 无 |
| `shell.execute` | 执行 Shell 命令 | `command`, `timeout` |
| `process.list` | 列出进程 | 无 |
| `file.list` | 列出文件 | `path` |
| `browser.open` | 打开浏览器 | `url` |

---

## 安装部署

### 前置条件

- OpenClaw 网关已安装并运行
- Node.js 18+ 环境
- 远程设备可访问 OpenClaw 服务器的 8765 端口

### 步骤一：安装插件

```bash
# 方法1：从工作目录安装
cd /path/to/claw-remote-agent-plugin
openclaw plugins install .

# 方法2：直接复制到扩展目录
cp -r ./claw-remote-agent-plugin ~/.openclaw/extensions/claw-remote-agent-plugin
```

### 步骤二：生成 Token

使用插件提供的工具生成认证 Token：

```
调用: remote_agent.generate_token

返回:
{
  "token": "agent-abc123def456...",
  "note": "请在 openclaw.json 插件配置中添加: token: \"agent-abc123def456...\"",
  "server_url": "ws://<openclaw服务器地址>:8765/agent/ws",
  "client_config": "在客户端 agent.yml 中配置: auth.token: \"agent-abc123def456...\""
}
```

### 步骤三：配置插件

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "entries": {
      "claw-remote-agent-plugin": {
        "enabled": true,
        "config": {
          "port": 8765,
          "host": "0.0.0.0",
          "token": "agent-your-token-here"
        }
      }
    }
  }
}
```

### 步骤四：重启网关

```bash
openclaw gateway restart
```

### 步骤五：部署客户端

在远程设备上部署 `claw-agent-client-rs` 客户端：

```bash
# 克隆客户端仓库
git clone https://gitee.com/yuzhanfeng/claw-agent-client-rs.git
cd claw-agent-client-rs

# 编译（需要 Rust 环境）
cargo build --release

# 配置
cp config/agent.yml.example config/agent.yml
# 编辑 agent.yml，填入 agent_id、server_url 和 token

# 运行
./target/release/claw-agent-client-rs
```

---

## 配置说明

### 服务端配置项

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `token` | string | ✅ 是 | - | 单一认证 Token，所有客户端使用 |
| `port` | number | 否 | `8765` | WebSocket 服务端口 |
| `host` | string | 否 | `"0.0.0.0"` | 监听地址 |

### 持久化文件

客户端信息保存在 `~/.openclaw/claw-remote-agent-plugin.json`：

```json
{
  "clients": {
    "desktop-pc": {
      "lastSessionId": "xxx-xxx",
      "lastConnectedAt": "2026-03-05T10:00:00.000Z",
      "registeredAt": "2026-03-05T09:00:00.000Z"
    },
    "laptop": {
      "lastSessionId": "yyy-yyy",
      "lastConnectedAt": "2026-03-05T11:00:00.000Z",
      "registeredAt": "2026-03-05T09:30:00.000Z"
    }
  }
}
```

### 客户端配置 (agent.yml)

```yaml
# 设备 ID（自定义，用于标识这台设备）
agent_id: "台式机"

# 服务器地址
server_url: "ws://192.168.1.100:8765"

# 认证 Token（与服务端配置一致）
auth:
  token: "agent-your-token-here"

```

---

## 工具使用

### 生成令牌

生成服务器使用的认证 Token：

```
调用: remote_agent.generate_token
参数: {}

返回:
{
  "token": "agent-abc123def456...",
  "note": "请在 openclaw.json 插件配置中添加: token: \"agent-abc123def456...\"",
  "server_url": "ws://<openclaw服务器地址>:8765/agent/ws",
  "client_config": "在客户端 agent.yml 中配置: auth.token: \"agent-abc123def456...\""
}
```

### 服务器状态

查看服务器运行状态：

```
调用: remote_agent.server_status
参数: {}

返回:
{
  "status": "运行中",
  "port": 8765,
  "host": "0.0.0.0",
  "configured_agents": 2,
  "connected_agents": 1
}
```

### 执行命令

在远程设备上执行命令：

```
调用: remote_agent.shell_exec
参数: {
  "agentId": "台式机",
  "command": "dir C:\\",
  "timeout": 10000
}

返回:
{
  "agent_id": "台式机",
  "command": "dir C:\\",
  "result": {
    "stdout": " 驱动器 C 中的卷没有标签。\n...",
    "stderr": "",
    "exit_code": 0
  }
}
```

### 获取系统信息

```
调用: remote_agent.get_system_info
参数: { "agentId": "台式机" }

返回:
{
  "agent_id": "台式机",
  "system_info": {
    "hostname": "DESKTOP-PC",
    "os_type": "windows",
    "os_version": "10.0.19045",
    "arch": "x64",
    "username": "admin",
    "cpu_count": 8,
    "total_memory_gb": 16.0,
    "available_memory_gb": 8.5
  }
}
```

---

## 客户端配置

### Rust 客户端 (claw-agent-client-rs)

**仓库地址**：https://gitee.com/yuzhanfeng/claw-agent-client-rs

**配置文件**：`config/agent.yml`

```yaml
agent_id: "台式机"
server_url: "ws://192.168.1.100:8765"

auth:
  token: "agent-your-token-here"

log:
  level: "info"
  file: "logs/agent.log"
```

**编译运行**：

```bash
# 开发模式
cargo run

# 生产模式
cargo build --release
./target/release/claw-agent-client-rs
```

---

## 通信协议

### WebSocket 消息格式

#### 1. 连接建立

服务端 → 客户端：
```json
{"type": "welcome", "version": "0.1.0", "platform": "claw-remote-agent-plugin"}
```

#### 2. 认证

客户端 → 服务端：
```json
{"type": "auth", "agent_id": "台式机", "token": "agent-your-token"}
```

服务端 → 客户端：
```json
{"type": "auth_response", "success": true, "session_id": "uuid", "message": "认证成功"}
```

#### 3. 命令推送

服务端 → 客户端：
```json
{
  "command_id": "cmd-1234567890-1",
  "action": "shell.execute",
  "params": {"command": "whoami", "timeout": 30000}
}
```

客户端 → 服务端：
```json
{
  "type": "command_response",
  "command_id": "cmd-1234567890-1",
  "success": true,
  "data": {"stdout": "admin\n", "stderr": "", "exit_code": 0}
}
```

### Unix Socket 接口

**连接地址**：`/tmp/claw-remote-agent-plugin.sock`

**请求示例**：

```bash
# 查看服务器状态
echo '{"type": "server_status"}' | nc -U /tmp/claw-remote-agent-plugin.sock

# 执行命令
echo '{"type": "shell_exec", "agentId": "台式机", "params": {"command": "whoami"}}' | nc -U /tmp/claw-remote-agent-plugin.sock

# 订阅事件
echo '{"type": "subscribe", "subscribe": true}' | nc -U /tmp/claw-remote-agent-plugin.sock
```

---

## 故障排除

### 常见问题

#### 1. 客户端无法连接

**症状**：客户端日志显示连接失败

**排查步骤**：
```bash
# 检查端口是否监听
netstat -tlnp | grep 8765

# 检查防火墙
sudo ufw status
sudo ufw allow 8765/tcp

# 检查服务端日志
tail -f /tmp/openclaw/openclaw-*.log | grep claw-remote-agent-plugin
```

#### 2. 认证失败

**症状**：服务端返回 "Invalid token"

**排查步骤**：
1. 确认客户端 `token` 与服务端配置完全一致
2. 检查是否有多余的空格或换行

#### 3. 客户端已在线被拒绝

**症状**：服务端返回 "Agent is already connected. Only one client per agent is allowed."

**说明**：这是正常行为，同一 agent_id 只能有一个在线连接

**解决**：
1. 确认没有其他客户端使用相同 agent_id
2. 如果是之前连接断开后重连失败，请等待几秒后再试

#### 4. 命令执行超时

**症状**：发送命令后长时间无响应

**可能原因**：
- 客户端未正确处理命令
- 网络延迟过高

**排查步骤**：
```bash
# 查看日志
tail -f logs/agent.log

# 检查 WebSocket 连接状态
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Key: test" -H "Sec-WebSocket-Version: 13" http://localhost:8765/agent/ws
```

#### 5. Unix Socket 无法连接

**症状**：`nc -U` 连接失败

**排查步骤**：
```bash
# 检查 Socket 文件
ls -la /tmp/claw-remote-agent-plugin.sock

# 检查权限
chmod 666 /tmp/claw-remote-agent-plugin.sock

# 重启插件
openclaw gateway restart
```

### 日志查看

```bash
# 服务端日志
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep -i remote-agent

# 客户端日志
tail -f logs/agent.log
```

---

## 相关链接

- **客户端仓库**：https://gitee.com/yuzhanfeng/claw-agent-client-rs.git
- **客户端仓库**：https://github.com/easy-do/claw-agent-client-rs.git
- **OpenClaw 文档**：https://docs.openclaw.ai
