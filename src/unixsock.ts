import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { getServerInstance } from './server.js';

const DEFAULT_SOCKET_PATH = '/tmp/claw-remote-agent-plugin.sock';

interface UnixSocketServer {
  server: net.Server;
  socketPath: string;
  clients: Set<net.Socket>;
}

let unixSocketServer: UnixSocketServer | null = null;

/**
 * Start Unix Socket server for real-time communication
 */
export function startUnixSocketServer(socketPath: string = DEFAULT_SOCKET_PATH): void {
  // Remove existing socket file
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch (e) {
    console.log('[claw-remote-agent-plugin] Failed to remove existing socket:', (e as Error).message);
  }

  const server = net.createServer((socket) => {
    console.log('[claw-remote-agent-plugin] Unix Socket client connected');
    
    if (unixSocketServer) {
      unixSocketServer.clients.add(socket);
    }

    // Send welcome message
    socket.write(JSON.stringify({
      type: 'welcome',
      message: 'Connected to claw-remote-agent-plugin Unix Socket',
      timestamp: new Date().toISOString()
    }) + '\n');

    // Handle incoming messages
    socket.on('data', async (data) => {
      try {
        const message = data.toString().trim();
        const request = JSON.parse(message);
        
        console.log('[claw-remote-agent-plugin] Unix Socket request:', request.type);
        console.log('[claw-remote-agent-plugin] Unix Socket request details:', JSON.stringify(request));
        
        const response = await handleUnixSocketRequest(request);
        
        console.log('[claw-remote-agent-plugin] Unix Socket response:', JSON.stringify(response).slice(0, 200));
        socket.write(JSON.stringify(response) + '\n');
      } catch (e) {
        console.error('[claw-remote-agent-plugin] Unix Socket error:', (e as Error).message);
        socket.write(JSON.stringify({
          type: 'error',
          error: (e as Error).message
        }) + '\n');
      }
    });

    socket.on('close', () => {
      console.log('[claw-remote-agent-plugin] Unix Socket client disconnected');
      if (unixSocketServer) {
        unixSocketServer.clients.delete(socket);
      }
    });

    socket.on('error', (err) => {
      console.error('[claw-remote-agent-plugin] Unix Socket error:', err.message);
    });
  });

  server.on('error', (err) => {
    console.error('[claw-remote-agent-plugin] Unix Socket server error:', err.message);
  });

  server.on('listening', () => {
    console.log('[claw-remote-agent-plugin] Unix Socket server listening on', socketPath);
    // Set socket permissions
    try {
      fs.chmodSync(socketPath, 0o666);
    } catch (e) {
      console.log('[claw-remote-agent-plugin] Failed to set socket permissions:', (e as Error).message);
    }
  });

  server.listen(socketPath);

  unixSocketServer = {
    server,
    socketPath,
    clients: new Set(),
  };
}

/**
 * Stop Unix Socket server
 */
export function stopUnixSocketServer(): void {
  if (unixSocketServer) {
    unixSocketServer.server.close(() => {
      console.log('[claw-remote-agent-plugin] Unix Socket server stopped');
    });
    
    // Close all client connections
    for (const client of unixSocketServer.clients) {
      client.end();
    }
    unixSocketServer.clients.clear();
    
    // Remove socket file
    try {
      if (fs.existsSync(unixSocketServer.socketPath)) {
        fs.unlinkSync(unixSocketServer.socketPath);
      }
    } catch (e) {
      console.log('[claw-remote-agent-plugin] Failed to remove socket file:', (e as Error).message);
    }
    
    unixSocketServer = null;
  }
}

/**
 * Handle incoming Unix Socket request
 */
async function handleUnixSocketRequest(request: {
  type: string;
  agentId?: string;
  action?: string;
  params?: Record<string, unknown>;
  timeout?: number;
  subscribe?: boolean;
}): Promise<Record<string, unknown>> {
  const server = getServerInstance();
  
  if (!server) {
    return {
      type: 'error',
      error: 'Server not running'
    };
  }

  switch (request.type) {
    case 'list_agents':
      return {
        type: 'list_agents',
        agents: server.getConfiguredAgents(),
        connected: server.getConnectedAgents(),
      };

    case 'server_status':
      return {
        type: 'server_status',
        status: 'running',
        configured_agents: server.getConfiguredAgents().length,
        connected_agents: server.getSessionCount(),
      };

    case 'send_command':
      if (!request.agentId || !request.action) {
        return {
          type: 'error',
          error: 'Missing agentId or action'
        };
      }
      
      try {
        const result = await server.sendCommand(
          request.agentId,
          request.action!,
          request.params || {},
          request.timeout || 30000
        );
        
        return {
          type: 'command_result',
          agent_id: request.agentId,
          action: request.action,
          result: result,
        };
      } catch (e) {
        return {
          type: 'error',
          error: (e as Error).message
        };
      }

    case 'shell_exec':
      if (!request.agentId || !request.params?.command) {
        return {
          type: 'error',
          error: 'Missing agentId or command'
        };
      }
      
      console.log('[claw-remote-agent-plugin] Unix Socket sending command to', request.agentId, ':', request.params.command);
      
      try {
        const result = await server.sendCommand(
          request.agentId,
          'shell.execute',
          request.params,
          request.timeout || 30000
        );
        console.log('[claw-remote-agent-plugin] Unix Socket command result:', result);
        
        return {
          type: 'command_result',
          agent_id: request.agentId,
          action: 'shell.execute',
          result: result,
        };
      } catch (e) {
        return {
          type: 'error',
          error: (e as Error).message
        };
      }

    case 'get_system_info':
      if (!request.agentId) {
        return {
          type: 'error',
          error: 'Missing agentId'
        };
      }
      
      try {
        const result = await server.sendCommand(
          request.agentId,
          'system.info',
          {},
          request.timeout || 30000
        );
        
        return {
          type: 'command_result',
          agent_id: request.agentId,
          action: 'system.info',
          result: result,
        };
      } catch (e) {
        return {
          type: 'error',
          error: (e as Error).message
        };
      }

    case 'subscribe':
      // Subscribe to real-time events from clients
      if (request.subscribe) {
        return {
          type: 'subscribed',
          message: 'Subscribed to real-time events',
        };
      }
      return {
        type: 'error',
        error: 'Invalid subscribe request'
      };

    default:
      return {
        type: 'error',
        error: 'Unknown request type: ' + request.type
      };
  }
}

/**
 * Broadcast event to all connected Unix Socket clients
 */
export function broadcastToUnixSocketClients(event: Record<string, unknown>): void {
  if (!unixSocketServer) {
    return;
  }

  const message = JSON.stringify(event) + '\n';
  
  for (const client of unixSocketServer.clients) {
    try {
      if (client.writable) {
        client.write(message);
      }
    } catch (e) {
      console.log('[claw-remote-agent-plugin] Failed to broadcast to client:', (e as Error).message);
    }
  }
}

/**
 * Get Unix Socket path
 */
export function getUnixSocketPath(): string {
  return unixSocketServer?.socketPath || DEFAULT_SOCKET_PATH;
}
