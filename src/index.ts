#!/usr/bin/env node

import { loadConfig } from './config.js';
import { McpStdioProxy } from './stdio-proxy.js';
import { logInfo, logError, formatError, configureLogging, isDebugMode } from './logger.js';

function showHelp(): void {
  const helpData = {
    title: 'MCP Stdio-HTTP Proxy',
    description: 'A proxy that discovers and connects to OAuth-protected MCP servers. The proxy automatically discovers OAuth endpoints and metadata from the MCP server.',
    usage: [
      'npx mcp-stdio-http-proxy',
      'node dist/index.js'
    ],    options: {
      '--help, -h': 'Show this help message',
      '--debug, -d': 'Enable debug logging (shows all log messages)',
      '--quiet, -q': 'Disable all logging except errors'
    },
    environmentVariables: {
      'OAUTH_CLIENT_ID': 'OAuth client ID for the MCP server (required)',
      'OAUTH_CLIENT_SECRET': 'OAuth client secret (optional - for public apps)',
      'MCP_SERVER_URL': 'HTTP SSE MCP server URL (required)',
      'OAUTH_REDIRECT_URI': 'OAuth redirect URI (default: http://localhost:3000/oauth/callback)',      'OAUTH_SCOPES': 'Additional OAuth scopes (optional - scopes are discovered automatically)',
      'LOG_LEVEL': 'Logging level (default: info)',
      'DEBUG': 'Enable debug mode (same as --debug flag)',
      'QUIET': 'Disable logging (same as --quiet flag)'
    },
    howItWorks: [
      'Makes an initial request to the MCP server to discover OAuth metadata',
      'Extracts protected resource metadata and authorization server endpoints',
      'Performs OAuth authorization code flow with PKCE',
      'Uses obtained access token to authenticate with the MCP server'
    ],
    claudeDesktopConfigExample: {
      "mcpServers": {
        "protected-mcp-server": {
          "command": "npx",
          "args": ["mcp-stdio-http-proxy"],
          "env": {
            "OAUTH_CLIENT_ID": "your_oauth_client_id",
            "OAUTH_CLIENT_SECRET": "your_oauth_client_secret_or_empty_for_public_apps",
            "MCP_SERVER_URL": "https://your-protected-mcp-server.com/sse"
          }
        }
      }
    }
  };
  
  logInfo('Help information', helpData);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Configure logging first (before any log messages)
  configureLogging();
  
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }
  
  try {
    logInfo('MCP Stdio-HTTP Proxy starting');
    
    // Load configuration
    const config = loadConfig();
    logInfo('Configuration loaded', { serverName: config.mcpServer.name });
    
    // Create and start the proxy
    const proxy = new McpStdioProxy(config);
    
    // Handle graceful shutdown
    const cleanup = async (): Promise<void> => {
      logInfo('Received shutdown signal, cleaning up');
      await proxy.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGQUIT', cleanup);

    // Start the proxy
    await proxy.start();
    
    logInfo('Proxy is running and ready for connections from Claude Desktop');
    logInfo('Press Ctrl+C to stop');
  } catch (error) {
    logError('Failed to start proxy', { error: formatError(error) });
    process.exit(1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason: any, promise: any) => {
  logError('Unhandled Promise Rejection', { 
    reason: formatError(reason),
    promise: promise.toString()
  });
  process.exit(1);
});

process.on('uncaughtException', (error: any) => {
  logError('Uncaught Exception', formatError(error));
  process.exit(1);
});

main().catch((error) => {
  logError('Fatal error in main', formatError(error));
  process.exit(1);
});
