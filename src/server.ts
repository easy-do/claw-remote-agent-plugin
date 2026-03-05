import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { broadcastToUnixSocketClients } from './unixsock.js';

interface AgentConfig {
  enabled?: boolean;
  port?: number;
  host?: string;
  token: string;
  pluginDataPath?: string;
  pluginData?: {
    clients: Record<string, any>;
  };
}

interface CommandRequest {
  command_id: string;
  action: string;
  params: Record<string, unknown>;
}

interface CommandResponse {
  type: string;
  command_id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface AuthRequest {
  type: string;
  agent_id: string;
  token: string;
}

interface AuthResponse {
  type: string;
  success?: boolean;
  session_id?: string;
  message?: string;
}

export interface AgentSession {
  agentId: string;
  sessionId: string;
  ws: WebSocket;
  connectedAt: Date;
  lastActivity: Date;
  status: "connected" | "busy" | "offline";
}

interface CommandEvent {
  action: string;
  params: Record<string, unknown>;
  session: AgentSession;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface PendingCommand {
  commandId: string;
  agentId: string;
  action: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
}

class RemoteAgentServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private sessions: Map<string, AgentSession> = new Map();
  private agentSessions: Map<string, AgentSession[]> = new Map();
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private config: AgentConfig;
  private api: OpenClawPluginApi;
  private log: (msg: string) => void;
  private commandCounter: number = 0;

  constructor(api: OpenClawPluginApi, config: AgentConfig) {
    super();
    this.api = api;
    this.config = config;
    this.log = (msg: string) => {
      try {
        const logger = (api.runtime as any).logger;
        if (logger && typeof logger.info === 'function') {
          logger.info("[claw-remote-agent-plugin] " + msg);
        } else {
          console.log("[claw-remote-agent-plugin] " + msg);
        }
      } catch (e) {
        console.log("[claw-remote-agent-plugin] " + msg);
      }
    };
  }

  start(): void {
    const port = this.config.port || 8765;
    const host = this.config.host || "0.0.0.0";

    this.wss = new WebSocketServer({
      host,
      port,
      path: "/agent/ws",
    });

    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.wss.on("error", (error) => {
      this.log("WebSocket server error: " + error.message);
    });

    this.log("Server started on ws://" + host + ":" + port + "/agent/ws");
    this.log("Server token configured: ***" + this.config.token.slice(-4));
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Server shutting down"));
    }
    this.pendingCommands.clear();

    for (const session of this.sessions.values()) {
      session.ws.close();
    }
    this.sessions.clear();
    this.agentSessions.clear();

    this.log("Server stopped");
  }

  private handleConnection(ws: WebSocket): void {
    this.log("New WebSocket connection");

    this.send(ws, {
      type: "welcome",
      version: "0.1.0",
      platform: "claw-remote-agent-plugin",
    });

    let session: AgentSession | null = null;
    let authenticated = false;

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.log("[WS IN] " + JSON.stringify(message).slice(0, 200));

        if (!authenticated) {
          if (message.type === "auth") {
            const authResult = await this.handleAuth(message as AuthRequest);
            this.send(ws, authResult);

            if (authResult.success) {
              authenticated = true;
              session = {
                agentId: message.agent_id,
                sessionId: authResult.session_id!,
                ws,
                connectedAt: new Date(),
                lastActivity: new Date(),
                status: "connected",
              };
              this.sessions.set(authResult.session_id!, session);
              this.log("[DEBUG] Session added, sessions.size=" + this.sessions.size);
              
              if (!this.agentSessions.has(message.agent_id)) {
                this.agentSessions.set(message.agent_id, []);
              }
              this.agentSessions.get(message.agent_id)!.push(session);
              this.log("[DEBUG] Agent session added for " + message.agent_id + ", agentSessions.size=" + this.agentSessions.size);
              
              this.log("[DEBUG] AgentSessions after auth: " + JSON.stringify(
                Array.from(this.agentSessions.entries()).map(([k, v]) => [k, v.length])
              ));
              
              broadcastToUnixSocketClients({
                type: 'agent_connected',
                agent_id: message.agent_id,
                session_id: authResult.session_id,
                timestamp: new Date().toISOString()
              });
              
              this.log("Agent " + message.agent_id + " authenticated, session: " + authResult.session_id);
            } else {
              this.log("Auth failed for agent " + message.agent_id + ": " + authResult.message);
            }
          } else {
            this.send(ws, {
              type: "error",
              message: "Authentication required. Send auth message first.",
            });
            ws.close(4001, "Authentication required");
          }
        } else {
          if (session) {
            session.lastActivity = new Date();
            
            if (message.type === "command_response") {
              this.handleCommandResponse(message);
            } else if (message.command_id && message.action) {
              await this.handleCommand(ws, session, message as CommandRequest);
            }
          }
        }
      } catch (error) {
        this.send(ws, {
          type: "error",
          message: "Invalid message: " + (error instanceof Error ? error.message : "Unknown error"),
        });
      }
    });

    ws.on("close", () => {
      if (session) {
        this.sessions.delete(session.sessionId);
        const agentSessions = this.agentSessions.get(session.agentId);
        if (agentSessions) {
          const idx = agentSessions.indexOf(session);
          if (idx >= 0) agentSessions.splice(idx, 1);
          if (agentSessions.length === 0) {
            this.agentSessions.delete(session.agentId);
            this.updateClientLastConnected(session.agentId);
            this.log("Agent " + session.agentId + " fully disconnected");
            
            broadcastToUnixSocketClients({
              type: 'agent_disconnected',
              agent_id: session.agentId,
              session_id: session.sessionId,
              timestamp: new Date().toISOString()
            });
          }
        }
        this.log("Session " + session.sessionId + " closed for agent " + session.agentId);
      }
    });

    ws.on("pong", () => {
      if (session) {
        session.lastActivity = new Date();
      }
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    ws.on("close", () => clearInterval(pingInterval));
  }

  private verifyToken(tokenStr: string): boolean {
    return tokenStr === this.config.token;
  }

  private savePluginData(): void {
    if (!this.config.pluginDataPath || !this.config.pluginData) return;
    try {
      const fs = require('fs');
      const data = JSON.stringify(this.config.pluginData, null, 2);
      fs.writeFileSync(this.config.pluginDataPath, data, 'utf-8');
      this.log("Plugin data saved");
    } catch (e) {
      this.log("Failed to save plugin data: " + (e as Error).message);
    }
  }

  private registerClient(agentId: string, sessionId: string): void {
    if (!this.config.pluginData) {
      this.config.pluginData = { clients: {} };
    }
    if (!this.config.pluginData.clients) {
      this.config.pluginData.clients = {};
    }
    
    const clientInfo = this.config.pluginData.clients[agentId] || {};
    clientInfo.lastSessionId = sessionId;
    clientInfo.lastConnectedAt = new Date().toISOString();
    clientInfo.registeredAt = clientInfo.registeredAt || new Date().toISOString();
    
    this.config.pluginData.clients[agentId] = clientInfo;
    this.savePluginData();
  }

  private updateClientLastConnected(agentId: string): void {
    if (!this.config.pluginData || !this.config.pluginData.clients) {
      return;
    }
    
    const clientInfo = this.config.pluginData.clients[agentId];
    if (clientInfo) {
      clientInfo.lastConnectedAt = new Date().toISOString();
      this.savePluginData();
    }
  }

  private async handleAuth(request: AuthRequest): Promise<AuthResponse> {
    if (!this.verifyToken(request.token)) {
      return {
        type: "auth_response",
        success: false,
        message: "Invalid token",
      };
    }

    const agentId = request.agent_id;
    if (!agentId || agentId.trim() === "") {
      return {
        type: "auth_response",
        success: false,
        message: "agent_id is required",
      };
    }

    if (this.agentSessions.has(agentId)) {
      const existingSessions = this.agentSessions.get(agentId)!;
      const connectedSessions = existingSessions.filter(s => s.status === "connected");
      if (connectedSessions.length > 0) {
        return {
          type: "auth_response",
          success: false,
          message: "Agent '" + agentId + "' is already connected. Only one client per agent is allowed.",
        };
      }
    }

    const sessionId = randomUUID();
    this.registerClient(agentId, sessionId);

    return {
      type: "auth_response",
      success: true,
      session_id: sessionId,
      message: "Authenticated successfully",
    };
  }

  private handleCommandResponse(response: CommandResponse): void {
    const pending = this.pendingCommands.get(response.command_id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(response.command_id);
      
      if (response.success) {
        pending.resolve(response.data);
      } else {
        pending.reject(new Error(response.error || "Command failed"));
      }
    }
  }

  private async handleCommand(
    ws: WebSocket,
    session: AgentSession,
    request: CommandRequest
  ): Promise<void> {
    this.log("Command from " + session.agentId + ": " + request.action);

    try {
      const result = await this.executeCommand(request.action, request.params, session);
      
      const response: CommandResponse = {
        type: "command_response",
        command_id: request.command_id,
        success: true,
        data: result,
      };
      
      broadcastToUnixSocketClients({
        type: 'command_result',
        agent_id: session.agentId,
        command_id: request.command_id,
        action: request.action,
        success: true,
        result: result,
        timestamp: new Date().toISOString()
      });
      this.send(ws, response);
    } catch (error) {
      const response: CommandResponse = {
        type: "command_response",
        command_id: request.command_id,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
      this.send(ws, response);
    }
  }

  private async executeCommand(
    action: string,
    params: Record<string, unknown>,
    session: AgentSession
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.emit("command", {
        action,
        params,
        session,
        resolve,
        reject,
      });
    });
  }

  async sendCommand(agentId: string, action: string, params: Record<string, unknown>, timeoutMs: number = 30000): Promise<unknown> {
    this.log("[DEBUG] sendCommand called: agentId=" + agentId + ", action=" + action);
    this.log("[DEBUG] agentSessions keys: " + Array.from(this.agentSessions.keys()).join(", "));
    
    const sessions = this.agentSessions.get(agentId);
    this.log("[DEBUG] sessions for " + agentId + ": " + (sessions ? sessions.length : "null"));
    
    if (!sessions || sessions.length === 0) {
      this.log("[DEBUG] ERROR: Agent '" + agentId + "' is not connected");
      throw new Error("Agent '" + agentId + "' is not connected");
    }

    const session = sessions.find(s => s.status === "connected") || sessions[0];
    this.log("[DEBUG] Selected session: " + session.sessionId);
    this.log("[DEBUG] WebSocket readyState: " + session.ws.readyState + " (OPEN=1)");
    
    const commandId = "cmd-" + Date.now() + "-" + (++this.commandCounter);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        this.log("[DEBUG] Command " + commandId + " TIMED OUT");
        reject(new Error("Command timeout after " + timeoutMs + "ms"));
      }, timeoutMs);

      this.pendingCommands.set(commandId, {
        commandId,
        agentId,
        action,
        params,
        resolve,
        reject,
        timeout,
      });

      session.status = "busy";

      const command: CommandRequest = {
        command_id: commandId,
        action,
        params,
      };

      const commandStr = JSON.stringify(command);
      this.log("[DEBUG] About to send: " + commandStr.slice(0, 300));
      
      if (session.ws.readyState === WebSocket.OPEN) {
        this.log("[DEBUG] WebSocket is OPEN, calling ws.send()...");
        session.ws.send(commandStr, (err) => {
          if (err) {
            this.log("[DEBUG] ws.send ERROR: " + err.message);
          } else {
            this.log("[DEBUG] ws.send SUCCESS");
          }
        });
        this.log("Sent command " + commandId + " to " + agentId + ": " + action);
      } else {
        this.log("[DEBUG] WebSocket NOT OPEN! readyState: " + session.ws.readyState);
        clearTimeout(timeout);
        this.pendingCommands.delete(commandId);
        reject(new Error("WebSocket not open, readyState: " + session.ws.readyState));
      }
    });
  }

  async broadcastCommand(action: string, params: Record<string, unknown>): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    const promises: Promise<void>[] = [];

    for (const [agentId, sessions] of this.agentSessions.entries()) {
      const session = sessions.find(s => s.status === "connected") || sessions[0];
      
      const commandId = "cmd-" + Date.now() + "-" + (++this.commandCounter);
      
      const promise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingCommands.delete(commandId);
          results.set(agentId, { error: "Timeout" });
          resolve();
        }, 30000);

        this.pendingCommands.set(commandId, {
          commandId,
          agentId,
          action,
          params,
          resolve: (data) => {
            clearTimeout(timeout);
            results.set(agentId, data);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timeout);
            results.set(agentId, { error: error instanceof Error ? error.message : String(error) });
            resolve();
          },
          timeout,
        });

        session.status = "busy";
        this.send(session.ws, { command_id: commandId, action, params });
      });
      
      promises.push(promise);
    }

    await Promise.all(promises);
    return results;
  }

  getRegisteredAgents(): Array<{
    agent_id: string;
    status: string;
    sessions: number;
    lastConnected?: string;
    registeredAt?: string;
    sessionId?: string;
  }> {
    const agents: Array<{
      agent_id: string;
      status: string;
      sessions: number;
      lastConnected?: string;
      registeredAt?: string;
      sessionId?: string;
    }> = [];
    
    const clients = this.config.pluginData?.clients || {};
    const allAgentIds = new Set([
      ...Object.keys(clients),
      ...this.agentSessions.keys()
    ]);
    
    for (const agentId of allAgentIds) {
      const sessions = this.agentSessions.get(agentId) || [];
      const clientInfo = clients[agentId] || {};
      const connectedSessions = sessions.filter(s => s.status === "connected");
      
      agents.push({
        agent_id: agentId,
        status: connectedSessions.length > 0 ? "online" : "offline",
        sessions: sessions.length,
        lastConnected: clientInfo.lastConnectedAt,
        registeredAt: clientInfo.registeredAt,
        sessionId: connectedSessions.length > 0 ? connectedSessions[0].sessionId : undefined,
      });
    }
    
    return agents;
  }

  getConnectedAgents(): Array<{ agent_id: string; sessions: number; status: string }> {
    this.log("[DEBUG] getConnectedAgents called, agentSessions.size=" + this.agentSessions.size);
    const agents: Array<{ agent_id: string; sessions: number; status: string }> = [];
    
    for (const [agentId, sessions] of this.agentSessions.entries()) {
      const connectedSessions = sessions.filter(s => s.status === "connected").length;
      this.log("[DEBUG] agentId=" + agentId + ", sessions.length=" + sessions.length + ", connected=" + connectedSessions);
      agents.push({
        agent_id: agentId,
        sessions: sessions.length,
        status: connectedSessions > 0 ? "online" : "offline",
      });
    }
    this.log("[DEBUG] getConnectedAgents returning " + agents.length + " agents");
    
    return agents;
  }

  private send(ws: WebSocket, data: unknown): void {
    const dataStr = JSON.stringify(data);
    this.log("[WS OUT] readyState=" + ws.readyState + " data=" + dataStr.slice(0, 200));
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(dataStr);
    } else {
      this.log("[WS OUT] SKIPPED - WebSocket not open!");
    }
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    this.log("[DEBUG] getSessionCount called, sessions.size=" + this.sessions.size);
    return this.sessions.size;
  }
}

let serverInstance: RemoteAgentServer | null = null;

export function registerRemoteAgentServer(api: OpenClawPluginApi, config: AgentConfig): void {
  if (serverInstance) {
    serverInstance.stop();
  }

  serverInstance = new RemoteAgentServer(api, config);
  serverInstance.start();

  serverInstance.on("command", async (event: CommandEvent) => {
    try {
      const result = await handleAgentCommand(api, event.action, event.params, event.session);
      event.resolve(result);
    } catch (error) {
      event.reject(error);
    }
  });

  const rt = api.runtime as any;
  if (rt && rt.onShutdown) {
    rt.onShutdown(() => {
      if (serverInstance) {
        serverInstance.stop();
      }
    });
  }
}

export function getServerInstance(): RemoteAgentServer | null {
  return serverInstance;
}

async function handleAgentCommand(
  api: OpenClawPluginApi,
  action: string,
  params: Record<string, unknown>,
  session: AgentSession
): Promise<unknown> {
  switch (action) {
    case "system.info": {
      const os = await import("os");
      return {
        hostname: (api.runtime as any).hostname || "unknown",
        os_type: process.platform,
        os_version: os.release(),
        arch: process.arch,
        username: process.env.USER || "unknown",
        uptime_secs: Math.floor(process.uptime()),
        total_memory_gb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 100) / 100,
        available_memory_gb: Math.round((os.freemem() / 1024 / 1024 / 1024) * 100) / 100,
        cpu_count: os.cpus().length,
        cpu_usage_percent: 0,
      };
    }

    case "shell.execute": {
      const { exec } = await import("child_process");
      const command = params.command as string;
      const timeout = (params.timeout as number) || 30000;

      return new Promise((resolve, reject) => {
        exec(command, { timeout }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve({
              stdout,
              stderr,
              exit_code: 0,
            });
          }
        });
      });
    }

    case "process.list": {
      const { exec } = await import("child_process");
      return new Promise((resolve, reject) => {
        exec("ps aux", (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            const lines = stdout.split("\n").slice(1);
            const processes = lines.map((line) => {
              const parts = line.split(/\s+/);
              return {
                pid: parseInt(parts[1]) || 0,
                name: parts[10] || "unknown",
                cmd: parts.slice(10).join(" "),
                cpu_percent: parseFloat(parts[2]) || 0,
                memory_mb: Math.round(parseInt(parts[5]) / 1024) || 0,
                status: parts[7] || "unknown",
              };
            }).filter((p) => p.pid > 0);
            resolve(processes);
          }
        });
      });
    }

    case "file.list": {
      const fs = await import("fs");
      const path = await import("path");
      const dirPath = (params.path as string) || ".";
      
      const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return files.map((file) => ({
        name: file.name,
        path: path.join(dirPath, file.name),
        is_dir: file.isDirectory(),
        size_bytes: file.isFile() ? fs.statSync(path.join(dirPath, file.name)).size : 0,
        modified: file.isFile() ? fs.statSync(path.join(dirPath, file.name)).mtime.toISOString() : null,
      }));
    }

    default:
      throw new Error("Unknown action: " + action);
  }
}

export { RemoteAgentServer };

(global as any).sendCommandToAgent = async (agentId: string, action: string, params: Record<string, unknown>) => {
  if (serverInstance) {
    return serverInstance.sendCommand(agentId, action, params);
  }
  throw new Error('Server not running');
};
