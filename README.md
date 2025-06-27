# MCP Stdio-HTTP Proxy

A TypeScript-based proxy that bridges stdio MCP clients (like Claude Desktop) to HTTP Server-Sent Events (SSE) MCP servers with OAuth authentication support. The proxy automatically discovers OAuth endpoints and metadata from the MCP server following the Model Context Protocol OAuth specification.

## 🚀 Quick Start with npx

The easiest way to use this proxy is with `npx` - no installation required!

**Claude Desktop Configuration:**
```json
{
  "mcpServers": {
    "protected-mcp-server": {
      "command": "npx",
      "args": ["mcp-stdio-http-proxy"],      
      "env": {
        "OAUTH_CLIENT_ID": "your_oauth_client_id",
        "OAUTH_CLIENT_SECRET": "your_oauth_client_secret_or_empty_for_public_apps",
        "OAUTH_REDIRECT_URI": "http://localhost:3000",
        "MCP_SERVER_URL": "https://your-protected-mcp-server.com/sse"
      }
    }
  }
}
```

That's it! The proxy will be automatically downloaded and run when Claude Desktop starts.

## Overview

This proxy allows Claude Desktop and other stdio-based MCP clients to connect to HTTP-based MCP servers that require OAuth authentication. The proxy:

1. **Discovers OAuth metadata** from the MCP server using RFC 9396 (OAuth Protected Resource Metadata)
2. **Automatically performs OAuth flow** using discovered authorization server endpoints
3. **Handles the OAuth flow** including PKCE (Proof Key for Code Exchange) for security
4. **Proxies all MCP protocol messages** between stdio and HTTP SSE transports

## Features

- **Automatic OAuth Discovery**: Discovers protected resource metadata and authorization server endpoints from the MCP server
- **RFC 9396 Compliance**: Follows OAuth 2.0 Protected Resource Metadata specification
- **PKCE Support**: Uses Proof Key for Code Exchange for enhanced security
- **Protocol Translation**: Seamlessly converts between stdio and HTTP SSE MCP transports
- **Token Management**: Automatic token refresh and expiration handling  
- **Error Handling**: Comprehensive error handling and logging
- **Claude Desktop Compatible**: Works as a drop-in replacement for direct MCP server connections

## Prerequisites

- Node.js 18.0.0 or higher
- TypeScript
- OAuth application configured with your identity provider (Azure AD, Auth0, etc.)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Copy the environment configuration:
```bash
cp .env.example .env
```

3. Configure your OAuth settings in `.env`:
```env
OAUTH_CLIENT_ID=your_azure_app_client_id
OAUTH_CLIENT_SECRET=your_azure_app_client_secret
OAUTH_REDIRECT_URI=http://localhost:3000/oauth/callback
OAUTH_SCOPES=https://graph.microsoft.com/.default

MCP_SERVER_URL=https://your-mcp-server.com/sse
MCP_SERVER_NAME=NL2MSGraph

OAUTH_SERVER_PORT=3000
LOG_LEVEL=info
```

4. Build the project:
```bash
npm run build
```

## Usage

### Starting the Proxy

```bash
npm start
```

Or for development:
```bash
npm run dev
```

### OAuth Authentication Flow

1. When you start the proxy, it will automatically open your browser for OAuth authentication
2. Sign in with your Microsoft/Azure AD account
3. Grant the requested permissions
4. The browser will show a success message and you can close it
5. The proxy will now be authenticated and ready to forward requests

## Configuration

The proxy is configured via environment variables:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `OAUTH_CLIENT_ID` | OAuth application client ID | Yes | - |
| `OAUTH_CLIENT_SECRET` | OAuth application client secret | Yes | - |
| `OAUTH_REDIRECT_URI` | OAuth redirect URI | Yes | `http://localhost:3000/oauth/callback` |
| `OAUTH_SCOPES` | OAuth scopes (comma-separated) | No | `https://graph.microsoft.com/.default` |
| `MCP_SERVER_URL` | URL of the HTTP SSE MCP server | Yes | - |
| `MCP_SERVER_NAME` | Name of the MCP server | No | `MCP Server` |
| `OAUTH_SERVER_PORT` | Port for OAuth callback server | No | `3000` |
| `LOG_LEVEL` | Logging level | No | `info` |

## Architecture

```
Claude Desktop (stdio) <-> MCP Proxy <-> HTTP SSE MCP Server
                             |
                     MCP SDK OAuth Client
```

The proxy implements a bridge between two MCP transports:

- **Stdio Transport**: Communicates with Claude Desktop using standard input/output
- **HTTP SSE Transport**: Connects to the MCP server using Server-Sent Events with OAuth authentication

### OAuth Flow

The proxy uses the official **MCP TypeScript SDK's built-in OAuth client** to handle authentication:

1. **Automatic Discovery**: The MCP SDK automatically discovers OAuth metadata from the server
2. **PKCE Flow**: Implements OAuth 2.0 with PKCE for secure authentication  
3. **Token Management**: Handles token refresh and session management automatically
4. **Dynamic Registration**: Supports both pre-registered and dynamically registered OAuth clients

### Key Components

- **McpOAuthClient**: Wraps the MCP SDK client with OAuth provider integration
- **ProxyOAuthClientProvider**: Implements the `OAuthClientProvider` interface for the MCP SDK
- **McpStdioProxy**: Bridges stdio and HTTP transports, forwarding all MCP protocol methods
- **Express Callback Server**: Temporarily runs to capture OAuth authorization codes

1. **Claude Desktop** connects via stdio to the proxy
2. **MCP Proxy** handles OAuth authentication and protocol translation using the MCP SDK
3. **HTTP SSE MCP Server** receives authenticated requests via HTTP

## Development

### Project Structure

```
src/
├── index.ts            # Main entry point and CLI handling
├── config.ts           # Configuration loading from environment
├── types.ts            # TypeScript type definitions
├── mcp-oauth-client.ts # MCP SDK OAuth client wrapper
└── stdio-proxy.ts      # Main proxy logic with stdio transport
```

### Scripts

- `npm run build` - Build the TypeScript project
- `npm run dev` - Run in development mode with ts-node
- `npm start` - Run the built JavaScript
- `npm run clean` - Clean build artifacts

### Debugging

Set `LOG_LEVEL=debug` in your `.env` file for verbose logging.

## Troubleshooting

### OAuth Issues

1. **Browser doesn't open**: Check firewall settings and manually open the displayed URL
2. **Invalid redirect URI**: Ensure the redirect URI in your OAuth app matches the one in `.env`
3. **Token refresh fails**: Check that your OAuth app has the `offline_access` scope

### Connection Issues

1. **Can't connect to MCP server**: Verify the server URL and ensure it's running
2. **Timeout errors**: Check network connectivity and server responsiveness

## License

MIT License - see LICENSE file for details.
