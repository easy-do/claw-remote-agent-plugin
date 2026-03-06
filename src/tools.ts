import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { randomUUID } from "crypto";
import { getServerInstance } from "./server.js";

interface AgentConfig {
  token: string;
  port?: number;
  host?: string;
  pluginDataPath?: string;
  pluginData?: {
    clients: Record<string, any>;
  };
}

function safeLog(api: OpenClawPluginApi, msg: string) {
  try {
    const logger = (api.runtime as any).logger;
    if (logger && typeof logger.info === "function") {
      logger.info("[claw-remote-agent-plugin] " + msg);
    } else {
      console.log("[claw-remote-agent-plugin] " + msg);
    }
  } catch (e) {
    console.log("[claw-remote-agent-plugin] " + msg);
  }
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// Generate a secure random token
function generateSecureToken(): string {
  const randomPart = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  return "agent-" + randomPart.slice(0, 32);
}

export function registerRemoteAgentTools(api: OpenClawPluginApi, config: AgentConfig): void {
  api.registerTool(
    () => ({
      name: "remote_agent.generate_token",
      label: "生成服务器令牌",
      description: "生成服务器使用的认证令牌",
      parameters: Type.Object({}),
      async execute() {
        const newToken = generateSecureToken();
        return json({
          token: newToken,
          note: "请在 openclaw.json 插件配置中添加: token: \"" + newToken + "\"",
          server_url: "ws://<openclaw服务器地址>:8765/agent/ws",
          client_config: "在客户端 agent.yml 中配置: auth.token: \"" + newToken + "\"",
        });
      },
    }),
    { name: "remote_agent.generate_token" }
  );

  // Tool: List all agents with real-time status
  api.registerTool(
    () => ({
      name: "remote_agent.list_agents",
      label: "列出代理列表",
      description: "获取所有已注册代理的列表及实时在线状态",
      parameters: Type.Object({}),
      async execute() {
        const server = getServerInstance();
        if (!server) {
          return json({
            error: "服务器未运行",
            agents: [],
          });
        }
        
        const registeredAgents = server.getRegisteredAgents();
        
        return json({
          agents: registeredAgents,
          total_registered: registeredAgents.length,
          total_online: registeredAgents.filter(a => a.status === "online").length,
        });
      },
    }),
    { name: "remote_agent.list_agents" }
  );

  // Tool: Get server status
  api.registerTool(
    () => ({
      name: "remote_agent.server_status",
      label: "服务器状态",
      description: "获取远程代理服务器的运行状态统计",
      parameters: Type.Object({}),
      async execute() {
        const server = getServerInstance();
        if (!server) {
          return json({
            status: "未运行",
            port: config.port || 8765,
            host: config.host || "0.0.0.0",
          });
        }
        
        const registeredAgents = server.getRegisteredAgents();
        const onlineCount = registeredAgents.filter(a => a.status === "online").length;
        
        return json({
          status: "运行中",
          port: config.port || 8765,
          host: config.host || "0.0.0.0",
          total_registered: registeredAgents.length,
          total_online: onlineCount,
        });
      },
    }),
    { name: "remote_agent.server_status" }
  );

  // Tool: Execute shell command on agent
  api.registerTool(
    () => ({
      name: "remote_agent.shell_exec",
      label: "执行Shell命令",
      description: "在指定的远程代理上执行Shell命令",
      parameters: Type.Object({
        agentId: Type.String({ description: "目标代理ID（设备名称）" }),
        command: Type.String({ description: "要执行的Shell命令" }),
        timeout: Type.Optional(Type.Number({ 
          description: "超时时间（毫秒）",
          default: 30000 
        })),
      }),
      async execute(_toolCallId, params: { agentId: string; command: string; timeout?: number }) {
        const server = getServerInstance();
        if (!server) {
          return json({ error: "服务器未运行" });
        }
        
        try {
          const result = await server.sendCommand(
            params.agentId, 
            "shell.execute", 
            { command: params.command, timeout: params.timeout || 30000 }
          );
          return json({
            agent_id: params.agentId,
            command: params.command,
            result: result,
          });
        } catch (e) {
          return json({
            error: e instanceof Error ? e.message : String(e),
            agent_id: params.agentId,
            command: params.command,
          });
        }
      },
    }),
    { name: "remote_agent.shell_exec" }
  );

  // Tool: Get system info from agent
  api.registerTool(
    () => ({
      name: "remote_agent.get_system_info",
      label: "获取系统信息",
      description: "获取指定远程代理的系统信息（主机名、操作系统、CPU、内存等）",
      parameters: Type.Object({
        agentId: Type.String({ description: "目标代理ID（设备名称）" }),
      }),
      async execute(_toolCallId, params: { agentId: string }) {
        const server = getServerInstance();
        if (!server) {
          return json({ error: "服务器未运行" });
        }
        
        try {
          const result = await server.sendCommand(params.agentId, "system.info", {});
          return json({
            agent_id: params.agentId,
            system_info: result,
          });
        } catch (e) {
          return json({
            error: e instanceof Error ? e.message : String(e),
            agent_id: params.agentId,
          });
        }
      },
    }),
    { name: "remote_agent.get_system_info" }
  );

  // Tool: Disconnect an agent
  api.registerTool(
    () => ({
      name: "remote_agent.disconnect_agent",
      label: "断开代理连接",
      description: "断开指定远程代理的连接",
      parameters: Type.Object({
        sessionId: Type.String({ description: "要断开的会话ID" }),
      }),
      async execute(_toolCallId, params: { sessionId: string }) {
        const server = getServerInstance();
        if (!server) {
          return json({ error: "服务器未运行" });
        }
        
        try {
          const sessions = server.getSessions();
          const session = sessions.find((s) => s.sessionId === params.sessionId);
          
          if (!session) {
            return json({ error: "会话 " + params.sessionId + " 未找到" });
          }
          
          session.ws.close(4000, "已被管理员断开");
          
          return json({
            success: true,
            session_id: params.sessionId,
            agent_id: session.agentId,
            message: "代理 " + session.agentId + " 已断开连接",
          });
        } catch (e) {
          return json({
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    }),
    { name: "remote_agent.disconnect_agent" }
  );

  // Tool: Read file from agent
  api.registerTool(
    () => ({
      name: "remote_agent.file_read",
      label: "读取文件",
      description: "读取指定远程代理上的文件内容（文本或二进制转Base64）",
      parameters: Type.Object({
        agentId: Type.String({ description: "目标代理ID（设备名称）" }),
        path: Type.String({ description: "要读取的文件路径" }),
        maxSize: Type.Optional(Type.Number({ 
          description: "最大读取字节数，默认10485760（10MB）",
          default: 10485760 
        })),
        encoding: Type.Optional(Type.String({ 
          description: "字符编码，默认utf-8",
          default: "utf-8" 
        })),
      }),
      async execute(_toolCallId, params: { agentId: string; path: string; maxSize?: number; encoding?: string }) {
        const server = getServerInstance();
        if (!server) {
          return json({ error: "服务器未运行" });
        }
        
        try {
          const result = await server.sendCommand(
            params.agentId,
            "file.read",
            {
              path: params.path,
              max_size: params.maxSize || 10485760,
              encoding: params.encoding || "utf-8"
            }
          );
          return json({
            agent_id: params.agentId,
            data: result,
          });
        } catch (e) {
          return json({
            error: e instanceof Error ? e.message : String(e),
            agent_id: params.agentId,
          });
        }
      },
    }),
    { name: "remote_agent.file_read" }
  );

  // Tool: Write file to agent
  api.registerTool(
    () => ({
      name: "remote_agent.file_write",
      label: "写入文件",
      description: "在指定远程代理上写入文件内容",
      parameters: Type.Object({
        agentId: Type.String({ description: "目标代理ID（设备名称）" }),
        path: Type.String({ description: "要写入的文件路径" }),
        content: Type.String({ description: "要写入的内容" }),
        append: Type.Optional(Type.Boolean({ 
          description: "是否追加模式，默认false（覆盖写入）",
          default: false 
        })),
        encoding: Type.Optional(Type.String({ 
          description: "字符编码，默认utf-8",
          default: "utf-8" 
        })),
      }),
      async execute(_toolCallId, params: { agentId: string; path: string; content: string; append?: boolean; encoding?: string }) {
        const server = getServerInstance();
        if (!server) {
          return json({ error: "服务器未运行" });
        }
        
        try {
          const result = await server.sendCommand(
            params.agentId,
            "file.write",
            {
              path: params.path,
              content: params.content,
              append: params.append || false,
              encoding: params.encoding || "utf-8"
            }
          );
          return json({
            agent_id: params.agentId,
            data: result,
          });
        } catch (e) {
          return json({
            error: e instanceof Error ? e.message : String(e),
            agent_id: params.agentId,
          });
        }
      },
    }),
    { name: "remote_agent.file_write" }
  );

  safeLog(api, "工具注册完成（中文模式）");
}