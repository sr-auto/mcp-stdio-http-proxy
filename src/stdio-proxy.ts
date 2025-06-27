import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { McpOAuthClient } from './mcp-oauth-client.js';
import { Config } from './types.js';
import { logInfo, logError, logWarn, logDebug, formatError } from './logger.js';

export class McpStdioProxy {
  private config: Config;
  private mcpOAuthClient: McpOAuthClient;
  private stdioServer: Server;
  private isConnected = false;

  constructor(config: Config) {
    this.config = config;
    this.mcpOAuthClient = new McpOAuthClient(config);

    // Create stdio server that will handle requests from Claude Desktop
    this.stdioServer = new Server(
      {
        name: config.mcpServer.name + '-proxy',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {}
        }
      }
    );

    this.setupProxyHandlers();
  }
  private setupProxyHandlers(): void {    // Handle list_tools requests
    this.stdioServer.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        this.ensureConnected();
        logDebug('Received list_tools request');
        const tools = await this.mcpOAuthClient.listTools();
        logInfo('Returning tools', { toolCount: tools.tools?.length || 0 });
        return tools;
      } catch (error) {
        logWarn('Error listing tools', { error: formatError(error) });
        return { tools: [] };
      }
    });

    // Handle call_tool requests
    this.stdioServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        this.ensureConnected();
        logDebug('Received call_tool request', { toolName: request.params.name });
        const result = await this.mcpOAuthClient.callTool(request.params);
        logInfo('Tool executed successfully', { toolName: request.params.name });
        return result;
      } catch (error) {
        logError('Error calling tool', { 
          toolName: request.params.name, 
          error: formatError(error) 
        });
        throw error;
      }
    });    // Handle list_resources requests
    this.stdioServer.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        const resources = await this.mcpOAuthClient.listResources();
        return resources;
      } catch (error) {
        logWarn('Error listing resources', { error: formatError(error) });
        return { resources: [] };
      }
    });

    // Handle read_resource requests
    this.stdioServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      try {
        const result = await this.mcpOAuthClient.readResource(request.params);
        return result;
      } catch (error) {
        logError('Error reading resource', { error: formatError(error) });
        throw error;
      }
    });

    // Handle list_prompts requests
    this.stdioServer.setRequestHandler(ListPromptsRequestSchema, async () => {
      try {
        const prompts = await this.mcpOAuthClient.listPrompts();
        return prompts;
      } catch (error) {
        logWarn('Error listing prompts', { error: formatError(error) });
        return { prompts: [] };
      }
    });

    // Handle get_prompt requests
    this.stdioServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      try {
        const result = await this.mcpOAuthClient.getPrompt(request.params);
        return result;
      } catch (error) {
        logError('Error getting prompt', { error: formatError(error) });
        throw error;
      }
    });

    // Handle initialize request - delegate to the MCP client
    this.stdioServer.setRequestHandler(InitializeRequestSchema, async (request) => {
      try {
        // Since this is a proxy, we just forward the initialize to the upstream server
        // The actual connection will be handled by our OAuth client
        return {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
            resources: { subscribe: true, listChanged: true },
            prompts: { listChanged: true },
            logging: {}
          },
          serverInfo: {
            name: this.config.mcpServer.name + '-proxy',
            version: '1.0.0'
          }        };
      } catch (error) {
        logError('Error initializing', { error: formatError(error) });
        throw error;
      }
    });
  }

  private ensureConnected(): void {
    if (!this.isConnected) {
      throw new Error('Proxy not connected to MCP server. Connection may have failed during startup.');
    }
  }

  /**
   * Get the underlying MCP client for direct access
   */
  getMcpClient() {
    return this.mcpOAuthClient.getClient();
  }

  /**
   * Check if the proxy is connected to the upstream MCP server
   */
  get connected(): boolean {
    return this.isConnected && this.mcpOAuthClient.connected;
  }  async start(): Promise<void> {
    try {
      logInfo('Starting OAuth authentication and connecting to MCP server');

      // Connect to the MCP server with OAuth
      await this.mcpOAuthClient.connect();
      logInfo('Connected to MCP server with OAuth authentication');
      this.isConnected = true;

      // Start the stdio server to handle requests from Claude Desktop
      logInfo('Starting stdio proxy server');
      const transport = new StdioServerTransport();
      await this.stdioServer.connect(transport);
      logInfo('Stdio proxy server started - ready to accept connections');
    } catch (error) {
      logError('Error starting proxy', { error: formatError(error) });
      this.isConnected = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      logInfo('Shutting down proxy');

      this.isConnected = false;

      // Disconnect from MCP server
      await this.mcpOAuthClient.disconnect();

      // Close stdio server
      await this.stdioServer.close();

      logInfo('Proxy shut down successfully');
    } catch (error) {
      logError('Error shutting down proxy', { error: formatError(error) });
    }
  }
}
