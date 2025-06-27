import { Config } from './types.js';
import { logError } from './logger.js';
import * as dotenv from 'dotenv';

// Load environment variables from .env file if it exists
dotenv.config();

export function loadConfig(): Config {
    // Check for required environment variables but provide helpful error messages
    const missingVars: string[] = [];

    if (!process.env.OAUTH_CLIENT_ID) {
        missingVars.push('OAUTH_CLIENT_ID');
    }
    // Note: OAUTH_CLIENT_SECRET is optional for public OAuth applications

    if (!process.env.MCP_SERVER_URL) {
        missingVars.push('MCP_SERVER_URL');
    }    if (missingVars.length > 0) {
        const configurationHelp = {
            missingVariables: missingVars,
            environmentVariables: {
                'OAUTH_CLIENT_ID': 'OAuth client ID for the MCP server (required)',
                'OAUTH_CLIENT_SECRET': 'OAuth client secret (optional for public apps)',
                'MCP_SERVER_URL': 'HTTP SSE MCP server URL (required)',
                'OAUTH_REDIRECT_URI': 'OAuth callback URL (default: http://localhost:3000/oauth/callback)',
                'OAUTH_SCOPES': 'Comma-separated OAuth scopes (default: mcp.read,mcp.write)',
                'OAUTH_SERVER_PORT': 'Local callback server port (default: 3000)',
                'MCP_SERVER_NAME': 'Display name for the server (optional)',
                'LOG_LEVEL': 'Logging level: debug|info|warn|error (default: info)'
            },
            exampleClaudeDesktopConfiguration: {
                "mcpServers": {
                    "protected-mcp-server": {
                        "command": "npx",
                        "args": ["mcp-stdio-http-proxy"],
                        "env": {
                            "OAUTH_CLIENT_ID": "your_mcp_server_oauth_client_id",
                            "OAUTH_CLIENT_SECRET": "your_mcp_server_oauth_client_secret_or_empty_for_public_apps",
                            "MCP_SERVER_URL": "https://your-mcp-server.com/sse",
                            "OAUTH_REDIRECT_URI": "http://localhost:3000/oauth/callback",
                            "OAUTH_SCOPES": "mcp.read,mcp.write,custom.scope"
                        }
                    }
                }
            }
        };
        
        logError('Missing required environment variables', configurationHelp);
        throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }return {
        oauth: {
            clientId: process.env.OAUTH_CLIENT_ID!,
            clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
            redirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
            scopes: process.env.OAUTH_SCOPES?.split(',').map((s: string) => s.trim()).filter(s => s.length > 0) || []
        },
        mcpServer: {
            url: process.env.MCP_SERVER_URL!,
            name: process.env.MCP_SERVER_NAME || 'MCP Server'
        },
        oauthServer: {
            port: parseInt(process.env.OAUTH_SERVER_PORT || '3000', 10)
        },
        logLevel: (process.env.LOG_LEVEL as any) || 'info'
    };
}
