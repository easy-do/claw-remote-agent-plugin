# Remote Agent 远程代理插件

为 OpenClaw 提供远程设备管理能力的插件，支持多设备独立 Token 认证、命令推送和实时状态监控。

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

Remote Agent 是一个 OpenClaw 服务端插件，配合 `cross-platform-agent-rs` 客户端使用，实现对远程设备的控制和管理。

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

### 工作流程

1. **客户端连接**：客户端启动后，通过 WebSocket 连接到服务端 8765 端口
2. **身份认证**：客户端发送 agent_id 和 token 进行认证
3. **等待命令**：认证成功后，客户端保持连接，等待服务端推送命令
4. **命令执行**：服务端通过 AI 工具或 Unix Socket 发送命令，客户端执行后返回结果
5. **事件广播**：客户端上线/下线/命令结果等事件通过 Unix Socket 广播

### 关键技术点

| 组件 | 技术 | 说明 |
|------|------|------|
| WebSocket 服务 | ws 库 | 客户端长连接，支持双向通信 |
| Unix Socket | net 模块 | 本地进程间通信，实时事件推送 |
| Token 认证 | UUID 生成 | 每个设备独立 Token，安全隔离 |
| 工具注册 | OpenClaw SDK | 将远程操作注册为 AI 可调用的工具 |

---

## 功能列表

### 服务端工具

| 工具名称 | 中文标签 | 功能描述 |
|----------|----------|----------|
| `remote_agent.generate_token` | 生成代理令牌 | 为新设备生成认证 Token |
| `remote_agent.list_agents` | 列出代理列表 | 查看所有设备及其在线状态 |
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
cd /path/to/remote-agent-plugin
openclaw plugins install .

# 方法2：直接复制到扩展目录
cp -r ./remote-agent-plugin ~/.openclaw/extensions/remote-agent
```

### 步骤二：配置插件

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "entries": {
      "remote-agent": {
        "enabled": true,
        "config": {
          "port": 8765,
          "host": "0.0.0.0",
          "agents": {
            "台式机": "agent-desktop-a1b2c3d4e5f6g7h8",
            "笔记本": "agent-laptop-q7r8s9t0u1v2w3x4"
          }
        }
      }
    }
  }
}
```

### 步骤三：重启网关

```bash
openclaw gateway restart
```

### 步骤四：验证安装

```bash
# 检查服务状态
openclaw status

# 查看日志
tail -f /tmp/openclaw/openclaw-*.log | grep remote-agent
```

### 步骤五：部署客户端

在远程设备上部署 `cross-platform-agent-rs` 客户端：

```bash
# 克隆客户端仓库
git clone https://gitee.com/yuzhanfeng/cross-platform-agent-rs.git
cd cross-platform-agent-rs

# 编译（需要 Rust 环境）
cargo build --release

# 配置
cp config/agent.yml.example config/agent.yml
# 编辑 agent.yml，填入 agent_id、server_url 和 token

# 运行
./target/release/cross-platform-agent
```

---

## 配置说明

### 服务端配置项

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `agents` | object | ✅ 是 | - | 设备 ID 到 Token 的映射 |
| `port` | number | 否 | `8765` | WebSocket 服务端口 |
| `host` | string | 否 | `"0.0.0.0"` | 监听地址 |
| `unixSocket` | boolean | 否 | `true` | 是否启用 Unix Socket |
| `unixSocketPath` | string | 否 | `/tmp/openclaw-remote-agent.sock` | Unix Socket 路径 |
| `allowedAgents` | array | 否 | `[]` | 允许连接的设备白名单 |

### 客户端配置 (agent.yml)

```yaml
# 设备 ID（必须与服务端配置的 key 匹配）
agent_id: "台式机"

# 服务器地址
server_url: "ws://192.168.1.100:8765"

# 认证 Token（必须与服务端配置的 value 匹配）
auth:
  token: "agent-desktop-a1b2c3d4e5f6g7h8"

# 日志级别
log_level: "info"
```

---

## 工具使用

### 生成令牌

为新设备生成认证令牌：

```
调用: remote_agent.generate_token
参数: { "agentId": "新电脑" }

返回:
{
  "agent_id": "新电脑",
  "token": "agent-abc123def456...",
  "note": "请在客户端配置文件 agent.yml 中添加: auth.token: \"agent-abc123def456...\"",
  "server_url": "ws://<openclaw服务器地址>:8765/agent/ws"
}
```

### 列出设备

查看所有设备状态：

```
调用: remote_agent.list_agents
参数: { "showTokens": false }

返回:
{
  "agents": [
    {
      "agent_id": "台式机",
      "token": "***g7h8",
      "connected": true,
      "sessions": 1,
      "status": "online"
    },
    {
      "agent_id": "笔记本",
      "token": "***w3x4",
      "connected": false,
      "sessions": 0,
      "status": "离线"
    }
  ],
  "total_configured": 2,
  "total_online": 1
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

### Rust 客户端 (cross-platform-agent-rs)

**仓库地址**：https://gitee.com/yuzhanfeng/cross-platform-agent-rs

**配置文件**：`config/agent.yml`

```yaml
agent_id: "台式机"
server_url: "ws://192.168.1.100:8765"

auth:
  token: "agent-desktop-xxx"

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
./target/release/cross-platform-agent
```

### 客户端命令处理

客户端需要实现以下命令的处理逻辑：

```rust
async fn execute_command(action: &str, params: Value) -> Result<Value> {
    match action {
        "system.info" => get_system_info().await,
        "shell.execute" => {
            let command = params["command"].as_str().unwrap();
            execute_shell(command).await
        }
        "file.list" => {
            let path = params["path"].as_str().unwrap_or(".");
            list_files(path).await
        }
        "browser.open" => {
            let url = params["url"].as_str().unwrap();
            open_browser(url).await
        }
        _ => Err(anyhow!("Unknown action: {}", action))
    }
}
```

---

## 通信协议

### WebSocket 消息格式

#### 1. 连接建立

服务端 → 客户端：
```json
{"type": "welcome", "version": "0.1.0", "platform": "openclaw-remote-agent"}
```

#### 2. 认证

客户端 → 服务端：
```json
{"type": "auth", "agent_id": "台式机", "token": "agent-desktop-xxx"}
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

**连接地址**：`/tmp/openclaw-remote-agent.sock`

**请求示例**：

```bash
# 列出设备
echo '{"type": "list_agents"}' | nc -U /tmp/openclaw-remote-agent.sock

# 执行命令
echo '{"type": "shell_exec", "agentId": "台式机", "params": {"command": "whoami"}}' | nc -U /tmp/openclaw-remote-agent.sock

# 订阅事件
echo '{"type": "subscribe", "subscribe": true}' | nc -U /tmp/openclaw-remote-agent.sock
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
tail -f /tmp/openclaw/openclaw-*.log | grep remote-agent
```

#### 2. 认证失败

**症状**：服务端返回 "Invalid token"

**排查步骤**：
1. 确认 `agent_id` 在服务端 `agents` 配置中存在
2. 确认 `token` 与服务端配置完全一致
3. 检查是否有多余的空格或换行

#### 3. 命令执行超时

**症状**：发送命令后长时间无响应

**可能原因**：
- 客户端未正确处理命令
- 客户端与主循环存在锁竞争（已修复）
- 网络延迟过高

**排查步骤**：
```bash
# 查看客户端日志
tail -f logs/agent.log

# 检查 WebSocket 连接状态
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Key: test" -H "Sec-WebSocket-Version: 13" http://localhost:8765/agent/ws
```

#### 4. Unix Socket 无法连接

**症状**：`nc -U` 连接失败

**排查步骤**：
```bash
# 检查 Socket 文件
ls -la /tmp/openclaw-remote-agent.sock

# 检查权限
chmod 666 /tmp/openclaw-remote-agent.sock

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

## 版本历史

### v1.0.0 (2026-03-02)

- ✅ 独立 Token 认证方案
- ✅ WebSocket 长连接
- ✅ Unix Socket 实时事件
- ✅ 7 个 AI 工具注册
- ✅ 中文界面支持
- ✅ 客户端 Ping/Pong 锁竞争问题修复

---

## 相关链接

- **客户端仓库**：https://gitee.com/yuzhanfeng/cross-platform-agent-rs
- **OpenClaw 文档**：https://docs.openclaw.ai
- **问题反馈**：https://github.com/openclaw/openclaw/issues

---

## 许可证

MIT License