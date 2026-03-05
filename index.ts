import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from 'fs';
import * as path from 'path';

const plugin = {
  id: "claw-remote-agent-plugin",
  name: "claw-remote-agent-plugin",
  description: "Remote agent server with single token authentication",
  configSchema: {
    type: "object",
    properties: {
      port: { type: "number", default: 8765 },
      token: { type: "string" },
      unixSocket: { type: "boolean", default: true },
      unixSocketPath: { type: "string", default: "/tmp/claw-remote-agent-plugin.sock" },
    },
    required: ["token"],
  },
  register(api: OpenClawPluginApi) {
    const rt = api.runtime as any;
    const log = (msg: string) => {
      try { rt.logger?.info?.("[claw-remote-agent-plugin] " + msg); } catch(e) { console.log("[claw-remote-agent-plugin] " + msg); }
    };
    
    const configDir = path.join(process.env.HOME || '/home/node', '.openclaw');
    const configPath = path.join(configDir, 'openclaw.json');
    const pluginDataPath = path.join(configDir, 'claw-remote-agent-plugin.json');
    
    let config: any = { 
      token: "", 
      port: 8765, 
      host: "0.0.0.0",
      unixSocket: true,
      unixSocketPath: "/tmp/claw-remote-agent-plugin.sock"
    };
    
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const openclawConfig = JSON.parse(content);
      const pluginConfig = openclawConfig?.plugins?.entries?.['claw-remote-agent-plugin']?.config;
      
      if (pluginConfig?.token && typeof pluginConfig.token === 'string') {
        config.token = pluginConfig.token;
      }
      if (pluginConfig?.port) config.port = pluginConfig.port;
      if (pluginConfig?.host) config.host = pluginConfig.host;
      if (pluginConfig?.unixSocket !== undefined) config.unixSocket = pluginConfig.unixSocket;
      if (pluginConfig?.unixSocketPath) config.unixSocketPath = pluginConfig.unixSocketPath;
      
      log("Config loaded from " + configPath);
    } catch (e) {
      log("Failed to read config: " + (e as Error).message);
      throw new Error("claw-remote-agent-plugin: Cannot read config file");
    }
    
    if (!config.token || config.token.trim() === "") {
      throw new Error("claw-remote-agent-plugin: token is required");
    }
    
    let pluginData: any = { clients: {} };
    try {
      if (fs.existsSync(pluginDataPath)) {
        const dataContent = fs.readFileSync(pluginDataPath, 'utf-8');
        pluginData = JSON.parse(dataContent);
        if (!pluginData.clients) pluginData.clients = {};
      }
    } catch (e) {
      log("Failed to read plugin data file: " + (e as Error).message);
      pluginData = { clients: {} };
    }
    
    config.pluginDataPath = pluginDataPath;
    config.pluginData = pluginData;
    
    log("Token configured: ***" + config.token.slice(-4));
    
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
