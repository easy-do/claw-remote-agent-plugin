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
- 📱 **多设备管理** - 查看所有设备在线状态、管理设备连接

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
4. **内存维护**：客户端列表在内存中实时维护，服务重启后自动清空

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
| 内存管理 | Map 数据结构 | 客户端列表实时维护 |

---

## 功能列表

### 服务端工具

| 工具名称 | 中文标签 | 功能描述 |
|----------|----------|----------|
| `remote_agent.generate_token` | 生成服务器令牌 | 生成服务器使用的认证 Token |
| `remote_agent.list_agents` | 列出客户端列表 | 获取所有已注册代理的列表及实时在线状态 |
| `remote_agent.server_status` | 插件状态 | 获取插件运行状态统计（注册数量、在线数量） |
| `remote_agent.shell_exec` | 执行Shell命令 | 在远程设备上执行Shell命令 |
| `remote_agent.get_system_info` | 获取系统信息 | 获取设备的系统信息 |
| `remote_agent.disconnect_agent` | 断开代理连接 | 强制断开指定设备的连接 |
| `remote_agent.file_read` | 读取文件 | 读取远程设备的文件内容 |
| `remote_agent.file_write` | 写入文件 | 在远程设备上写入文件内容 |
| `remote_agent.file_delete` | 删除文件 | 删除远程设备的文件 |
| `remote_agent.file_list` | 列出文件 | 列出远程设备指定目录的文件 |
| `remote_agent.process_list` | 列出进程 | 列出远程设备上运行的进程 |
| `remote_agent.process_stop` | 停止进程 | 停止远程设备上的指定进程 |
| `remote_agent.software_list` | 列出已安装软件 | 列出远程设备上已安装的软件 |
| `remote_agent.env_list` | 列出环境变量 | 列出远程设备的环境变量 |
| `remote_agent.env_get` | 获取环境变量 | 获取远程设备的指定环境变量 |
| `remote_agent.env_set` | 设置环境变量 | 设置远程设备的环境变量 |
| `remote_agent.env_delete` | 删除环境变量 | 删除远程设备的环境变量 |
| `remote_agent.config_get` | 获取配置 | 获取远程设备的系统配置 |
| `remote_agent.config_set` | 设置配置 | 设置远程设备的系统配置 |
| `remote_agent.system_reboot` | 重启系统 | 重启远程设备 |
| `remote_agent.system_shutdown` | 关闭系统 | 关闭远程设备 |

### 客户端支持的命令

| 命令 | 说明 | 参数 |
|------|------|------|
| `capabilities` | 获取客户端支持的所有命令列表 | 无 |
| `system.info` | 获取系统信息 | 无 |
| `system.reboot` | 重启系统 | 无 |
| `system.shutdown` | 关闭系统 | 无 |
| `process.list` | 列出进程 | 无 |
| `process.stop` | 停止进程 | `pid`, `force` |
| `software.list` | 列出已安装软件 | 无 |
| `software.search` | 搜索软件 | `query` |
| `software.install` | 安装软件 | `package`, `silent` |
| `software.uninstall` | 卸载软件 | `package` |
| `env.list` | 列出环境变量 | `scope` |
| `env.get` | 获取环境变量 | `name`, `scope` |
| `env.set` | 设置环境变量 | `name`, `value`, `scope` |
| `env.delete` | 删除环境变量 | `name`, `scope` |
| `file.list` | 列出文件 | `path` |
| `file.read` | 读取文件内容 | `path` |
| `file.write` | 写入文件内容 | `path`, `content` |
| `file.delete` | 删除文件 | `path` |
| `file.create_dir` | 创建目录 | `path`, `recursive` |
| `file.copy` | 复制文件 | `src`, `dst` |
| `file.move` | 移动文件 | `src`, `dst` |
| `file.download` | 下载文件 | `url`, `dest` |
| `config.get` | 获取配置 | `path` |
| `config.set` | 设置配置 | `path`, `value` |
| `shell.execute` | 执行 Shell 命令 | `command`, `timeout` |

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

### 客户端列表

客户端列表在服务内存中实时维护，可通过工具查询：

```
调用: remote_agent.list_agents
参数: {}

返回:
{
  "agents": [
    {
      "agent_id": "台式机",
      "status": "online",
      "sessions": 1,
      "lastConnected": "2026-03-05T10:00:00.000Z",
      "registeredAt": "2026-03-05T09:00:00.000Z",
      "sessionId": "xxx-xxx-xxx"
    },
    {
      "agent_id": "笔记本",
      "status": "offline",
      "sessions": 0,
      "lastConnected": "2026-03-05T08:00:00.000Z",
      "registeredAt": "2026-03-05T07:30:00.000Z"
    }
  ],
  "total_registered": 2,
  "total_online": 1
}
```

**注意**：服务重启后，所有客户端连接记录将被清空，客户端需要重新连接。

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

### 列出客户端列表

获取所有已注册代理的列表及实时在线状态：

```
调用: remote_agent.list_agents
参数: {}

返回:
{
  "agents": [
    {
      "agent_id": "台式机",
      "status": "online",
      "sessions": 1,
      "lastConnected": "2026-03-05T10:00:00.000Z",
      "registeredAt": "2026-03-05T09:00:00.000Z",
      "sessionId": "xxx-xxx-xxx"
    },
    {
      "agent_id": "笔记本",
      "status": "offline",
      "sessions": 0,
      "lastConnected": "2026-03-05T08:00:00.000Z",
      "registeredAt": "2026-03-05T07:30:00.000Z"
    }
  ],
  "total_registered": 2,
  "total_online": 1
}
```

### 插件运行状态

插件运行状态：

```
调用: remote_agent.server_status
参数: {}

返回:
{
  "status": "运行中",
  "port": 8765,
  "host": "0.0.0.0",
  "total_registered": 2,
  "total_online": 1
}
```

## 支持命令

### capabilities 获取客户端能力
```json
{ "action": "capabilities", "params": {} }
```

### system.info 获取系统信息
```json
{ "action": "system.info", "params": {} }
```

### shell.execute 执行Shell命令
```json
{ "action": "shell.execute", "params": { "command": "dir", "timeout": 30 } }
```

### process.list 列出进程
```json
{ "action": "process.list", "params": {} }
```

### process.stop 停止进程
```json
{ "action": "process.stop", "params": { "pid": 1234, "force": false } }
```

### software.list 列出已安装软件
```json
{ "action": "software.list", "params": {} }
```

### software.search 搜索软件
```json
{ "action": "software.search", "params": { "query": "chrome" } }
```

### software.install 安装软件
```json
{ "action": "software.install", "params": { "package": "Google Chrome", "silent": true } }
```

### software.uninstall 卸载软件
```json
{ "action": "software.uninstall", "params": { "package": "Google Chrome" } }
```

### env.list 列出环境变量
```json
{ "action": "env.list", "params": { "scope": "user" } }
```

### env.get 获取环境变量
```json
{ "action": "env.get", "params": { "name": "PATH", "scope": "user" } }
```

### env.set 设置环境变量
```json
{ "action": "env.set", "params": { "name": "TEST", "value": "123", "scope": "user" } }
```

### env.delete 删除环境变量
```json
{ "action": "env.delete", "params": { "name": "TEST", "scope": "user" } }
```

### file.list 列出文件
```json
{ "action": "file.list", "params": { "path": "C:\\Users" } }
```

### file.read 读取文件内容
```json
{ "action": "file.read", "params": { "path": "C:\\test\\file.txt" } }
```

### file.write 写入文件内容
```json
{ "action": "file.write", "params": { "path": "C:\\test\\file.txt", "content": "hello" } }
```

### config.get 获取配置
```json
{ "action": "config.get", "params": { "path": "HKEY_CURRENT_USER\\Software\\Microsoft" } }
```

### config.set 设置配置
```json
{ "action": "config.set", "params": { "path": "HKEY_CURRENT_USER\\Test", "value": "123" } }
```

### system.reboot 重启系统
```json
{ "action": "system.reboot", "params": {} }
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
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep -i claw-remote-agent-plugin

# 客户端日志
tail -f logs/agent.log
```

---

## 相关链接

- **客户端仓库**：https://gitee.com/yuzhanfeng/claw-agent-client-rs.git
- **客户端仓库**：https://github.com/easy-do/claw-agent-client-rs.git
- **OpenClaw 文档**：https://docs.openclaw.ai
