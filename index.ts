import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from 'fs';
import * as path from 'path';

const plugin = {
  id: "remote-agent",
  name: "Remote Agent",
  description: "Remote agent server with independent token per agent and Unix Socket support",
  configSchema: {
    type: "object",
    properties: {
      port: { type: "number", default: 8765 },
      agents: { type: "object", additionalProperties: { type: "string" } },
      unixSocket: { type: "boolean", default: true },
      unixSocketPath: { type: "string", default: "/tmp/openclaw-remote-agent.sock" },
    },
    required: ["agents"],
  },
  register(api: OpenClawPluginApi) {
    const rt = api.runtime as any;
    const log = (msg: string) => {
      try { rt.logger?.info?.("[remote-agent] " + msg); } catch(e) { console.log("[remote-agent] " + msg); }
    };
    
    // Read config directly from openclaw.json
    const configPath = path.join(process.env.HOME || '/home/node', '.openclaw', 'openclaw.json');
    let config = { 
      agents: {} as Record<string, string>, 
      port: 8765, 
      host: "0.0.0.0",
      unixSocket: true,
      unixSocketPath: "/tmp/openclaw-remote-agent.sock"
    };
    
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const openclawConfig = JSON.parse(content);
      const pluginConfig = openclawConfig?.plugins?.entries?.['remote-agent']?.config;
      
      if (pluginConfig?.agents && typeof pluginConfig.agents === 'object') {
        config.agents = pluginConfig.agents;
      }
      if (pluginConfig?.port) config.port = pluginConfig.port;
      if (pluginConfig?.host) config.host = pluginConfig.host;
      if (pluginConfig?.unixSocket !== undefined) config.unixSocket = pluginConfig.unixSocket;
      if (pluginConfig?.unixSocketPath) config.unixSocketPath = pluginConfig.unixSocketPath;
      
      log("Config loaded from " + configPath);
    } catch (e) {
      log("Failed to read config: " + (e as Error).message);
      throw new Error("remote-agent: Cannot read config file");
    }
    
    if (!config.agents || Object.keys(config.agents).length === 0) {
      throw new Error("remote-agent: agents config is required and must have at least one agent");
    }
    
    log("Loaded agents: " + Object.keys(config.agents).join(", "));
    
    const serverModule = require("./src/server.js");
    const toolsModule = require("./src/tools.js");
    const unixsockModule = require("./src/unixsock.js");
    
    serverModule.registerRemoteAgentServer(api, config);
    toolsModule.registerRemoteAgentTools(api, config);
    
    // Start Unix Socket server for real-time communication
    if (config.unixSocket !== false) {
      unixsockModule.startUnixSocketServer(config.unixSocketPath);
      log("Unix Socket started on " + config.unixSocketPath);
    }
    
    log("Plugin registered successfully");
  },
};

export default plugin;
