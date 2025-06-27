import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
    OAuthClientProvider,
    auth,
    discoverOAuthProtectedResourceMetadata,
    UnauthorizedError,
    selectResourceURL,
    registerClient,
    exchangeAuthorization,
    refreshAuthorization,
    startAuthorization
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
    OAuthClientMetadata,
    OAuthClientInformation,
    OAuthTokens,
    OAuthProtectedResourceMetadata,
    OAuthMetadata,
    OAuthClientInformationFull
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
    ListToolsResult,
    CallToolRequest,
    CallToolResult,
    ListResourcesResult,
    ReadResourceRequest,
    ReadResourceResult,
    ListPromptsResult,
    GetPromptRequest,
    GetPromptResult
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { createHash, randomBytes } from 'crypto';
import { Config } from './types.js';
import { logInfo, logError, logWarn, logDebug, formatError } from './logger.js';

/**
 * ProxyOAuthProvider implements the OAuthClientProvider interface
 * to handle OAuth authentication for the MCP proxy
 */
class ProxyOAuthProvider implements OAuthClientProvider {
    private config: Config;
    private _tokens: OAuthTokens | undefined;
    private _clientInformation: OAuthClientInformation | undefined;
    private _codeVerifier: string | undefined;
    private _state: string | undefined;
    private oauthServer: any;

    constructor(config: Config) {
        this.config = config;
    }

    get redirectUrl(): string {
        return this.config.oauth.redirectUri;
    }
    get clientMetadata(): OAuthClientMetadata {
        return {
            client_name: 'MCP OAuth Proxy Client',
            client_uri: 'https://github.com/modelcontextprotocol/typescript-sdk',
            redirect_uris: [this.config.oauth.redirectUri],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: this.config.oauth.clientSecret ? 'client_secret_post' : 'none'
        };
    }

    async state(): Promise<string> {
        if (!this._state) {
            this._state = randomBytes(32).toString('hex');
        }
        return this._state;
    }

    clientInformation(): OAuthClientInformation | undefined {
        if (!this._clientInformation) {
            this._clientInformation = {
                client_id: this.config.oauth.clientId,
                client_secret: this.config.oauth.clientSecret
            };
        }
        return this._clientInformation;
    }

    saveClientInformation(clientInformation: OAuthClientInformationFull): void {
        this._clientInformation = clientInformation;
    }

    tokens(): OAuthTokens | undefined {
        return this._tokens;
    }    async saveTokens(tokens: OAuthTokens): Promise<void> {
        this._tokens = tokens;
        logInfo('OAuth tokens saved successfully');
    }
    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
        logInfo('Opening browser for OAuth authentication', {
            authorizationUrl: authorizationUrl.toString(),
            redirectUri: this.config.oauth.redirectUri,
            scopes: this.config.oauth.scopes
        });

        // Start local OAuth server to handle callback
        await this.startOAuthServer();

        // Open browser for OAuth flow
        try {
            const { default: open } = await import('open');
            await open(authorizationUrl.toString());
        } catch (error) {
            logWarn('Could not open browser automatically. Please visit the authorization URL manually', {
                authorizationUrl: authorizationUrl.toString()
            });
        }
    }

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
        this._codeVerifier = codeVerifier;
    }

    async codeVerifier(): Promise<string> {
        if (!this._codeVerifier) {
            throw new Error('Code verifier not found');
        }
        return this._codeVerifier;
    }

    private async startOAuthServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            const app = express();
            app.use(express.urlencoded({ extended: true }));

            // Parse the redirect URI to get the callback path
            const redirectUrl = new URL(this.config.oauth.redirectUri);
            const callbackPath = redirectUrl.pathname;

            app.get(callbackPath, async (req, res) => {
                try {
                    const { code, state: returnedState, error } = req.query;

                    if (error) {
                        res.send(`<h1>OAuth Error</h1><p>${error}</p>`);
                        this.oauthServer?.close();
                        return reject(new Error(`OAuth error: ${error}`));
                    }

                    if (returnedState !== this._state) {
                        res.send('<h1>OAuth Error</h1><p>Invalid state parameter</p>');
                        this.oauthServer?.close();
                        return reject(new Error('Invalid OAuth state'));
                    }

                    if (!code) {
                        res.send('<h1>OAuth Error</h1><p>No authorization code received</p>');
                        this.oauthServer?.close();
                        return reject(new Error('No authorization code received'));
                    }

                    res.send('<h1>Authentication Successful</h1><p>You can close this window and return to your application.</p>');
                    this.oauthServer?.close();

                    // Store the authorization code for the auth flow to complete
                    this.authorizationCode = code as string;
                    resolve();
                } catch (error) {
                    res.send(`<h1>OAuth Error</h1><p>${error}</p>`);
                    this.oauthServer?.close();
                    reject(error);
                }
            });

            // Use the port from the redirect URI if specified, otherwise use the configured port
            const port = redirectUrl.port ? parseInt(redirectUrl.port) : this.config.oauthServer.port;            this.oauthServer = app.listen(port, () => {
                logInfo('OAuth callback server listening', { port, callbackPath });
                resolve();
            });

            // Handle server startup errors
            this.oauthServer.on('error', (error: any) => {
                if (error.code === 'EADDRINUSE') {
                    logError('Port already in use', { 
                        port, 
                        error: 'Please set OAUTH_REDIRECT_URI to use a different port' 
                    });
                }
                reject(error);
            });

            // Set timeout for OAuth flow
            setTimeout(() => {
                this.oauthServer?.close();
                reject(new Error('OAuth authentication timed out'));
            }, 300000); // 5 minutes
        });
    }

    private authorizationCode: string | undefined;

    getAuthorizationCode(): string | undefined {
        return this.authorizationCode;
    }

    clearAuthorizationCode(): void {
        this.authorizationCode = undefined;
    }
}

async function discoverOAuthMetadata(serverUrl: string): Promise<OAuthMetadata> {
    logInfo('Discovering OAuth metadata from server', { serverUrl });

    const oauthMetadataUrl = new URL(serverUrl + '/.well-known/oauth-authorization-server');
    const openIdMetadataUrl = new URL(serverUrl + '/.well-known/openid-configuration');

    let metadata: Promise<OAuthMetadata> | undefined;

    try {
        // First try the standard OAuth metadata endpoint
        logDebug('Fetching OAuth metadata', { url: oauthMetadataUrl.toString() });
        const oauthResponse = await fetch(oauthMetadataUrl);
        if (oauthResponse.ok) {
            metadata = oauthResponse.json();
            logInfo('OAuth metadata found', { url: oauthMetadataUrl.toString() });
        }
        else {
            logWarn('Failed to fetch OAuth metadata', { 
                url: oauthMetadataUrl.toString(), 
                status: oauthResponse.statusText 
            });
            try {
                logDebug('Retrying with OpenID Connect metadata endpoint');
                logDebug('Fetching OpenID Connect metadata', { url: openIdMetadataUrl.toString() });
                // Then try OpenID Connect metadata endpoint
                const openIdResponse = await fetch(openIdMetadataUrl);                if (openIdResponse.ok) {
                    metadata = openIdResponse.json();
                    logInfo('OAuth metadata found at OpenID endpoint', { url: openIdMetadataUrl.toString() });
                }
            } catch (error) {
                logWarn('Failed to fetch OpenID metadata', { 
                    url: openIdMetadataUrl.toString(), 
                    error: formatError(error) 
                });
            }
        }
    } catch (error) {
        logWarn('Failed to fetch OAuth metadata', { error: formatError(error) });
    }

    return metadata || Promise.reject(new Error('No OAuth metadata found at either endpoint'));
}

async function customAuth(provider: ProxyOAuthProvider, options: { serverUrl: string, scope?: string, authorizationCode?: string, resourceMetadataUrl?: URL }): Promise<'AUTHORIZED' | 'REDIRECT'> {
    logInfo('Starting OAuth authentication', { serverUrl: options.serverUrl, options });
    let resourceMetadata: OAuthProtectedResourceMetadata | undefined;
    let authorizationServerUrl = options.serverUrl;    try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(options.serverUrl, { resourceMetadataUrl: options.resourceMetadataUrl });
        logInfo('Discovered OAuth protected resource metadata', { resourceMetadata });
        if (resourceMetadata.authorization_servers && resourceMetadata.authorization_servers.length > 0) {
            logInfo('Using authorization server', { authorizationServer: resourceMetadata.authorization_servers[0] });
            authorizationServerUrl = resourceMetadata.authorization_servers[0];
        }
    } catch {
        // Ignore errors and fall back to /.well-known/oauth-authorization-server
    }

    // const resource: URL | undefined = await selectResourceURL(options.serverUrl, provider, resourceMetadata);

    const metadata = await discoverOAuthMetadata(authorizationServerUrl);

    // Handle client registration if needed
    let clientInformation = await Promise.resolve(provider.clientInformation());
    if (!clientInformation) {
        if (options.authorizationCode !== undefined) {
            throw new Error("Existing OAuth client information is required when exchanging an authorization code");
        }

        if (!provider.saveClientInformation) {
            throw new Error("OAuth client information must be saveable for dynamic registration");
        }

        const fullInformation = await registerClient(authorizationServerUrl, {
            metadata,
            clientMetadata: provider.clientMetadata,
        });

        await provider.saveClientInformation(fullInformation);
        clientInformation = fullInformation;
    }

    // Exchange authorization code for tokens
    if (options.authorizationCode !== undefined) {
        logInfo(`Exchanging authorization code for tokens...`);
        const codeVerifier = await provider.codeVerifier();
        const tokens = await exchangeAuthorization(authorizationServerUrl, {
            metadata: metadata,
            clientInformation: clientInformation,
            authorizationCode: options.authorizationCode,
            codeVerifier: codeVerifier,
            redirectUri: provider.redirectUrl,
        });

        await provider.saveTokens(tokens);
        return "AUTHORIZED";
    }

    const tokens = await provider.tokens();

    // Handle token refresh or new authorization
    if (tokens?.refresh_token) {
        try {
            // Attempt to refresh the token
            const newTokens = await refreshAuthorization(authorizationServerUrl, {
                metadata,
                clientInformation,
                refreshToken: tokens.refresh_token
            });

            await provider.saveTokens(newTokens);
            return "AUTHORIZED";
        } catch {
            // Could not refresh OAuth tokens
        }
    }

    const state = provider.state ? await provider.state() : undefined;

    logInfo(`Metadata for OAuth server ${authorizationServerUrl}:`, { metadata });
    logInfo(`Client information for OAuth client:`, { clientInformation });
    logInfo(`State for OAuth flow:`, { state });

    var needCodeVerifier = false;
    if (metadata.code_challenge_methods_supported && !metadata.code_challenge_methods_supported.includes('S256')) {
        needCodeVerifier = true;
    }

    // Start new authorization flow
    let { authorizationUrl, codeVerifier } = await startAuthorization(authorizationServerUrl, {
        metadata: undefined,
        clientInformation,
        state,
        redirectUrl: provider.redirectUrl,
        scope: options.scope || provider.clientMetadata.scope
    });

    if (!authorizationUrl.toString().startsWith(authorizationServerUrl)) {
        logWarn(`Authorization URL ${authorizationUrl} does not match server URL ${authorizationServerUrl}. Adjusting...`);
        // Ensure the authorization URL is relative to the authorization server URL
        // Create a new URL using the authorization server as the base
        // but keeping the path, query parameters, etc. from the authorization URL
        if (!authorizationServerUrl.endsWith('/oauth2/v2.0') && authorizationServerUrl.endsWith('/v2.0')) {
            // If the authorization server URL ends with /v2.0/, we need to adjust it
            authorizationServerUrl = authorizationServerUrl.replace('/v2.0', '/oauth2/v2.0');
        }

        const newAuthUrl = new URL(authorizationServerUrl + '/authorize' + authorizationUrl.search);
        authorizationUrl = newAuthUrl;
    }

    await provider.saveCodeVerifier(codeVerifier);
    await provider.redirectToAuthorization(authorizationUrl);
    return "REDIRECT";
}

export class McpOAuthClient {
    private config: Config;
    private mcpClient: Client | null = null;
    private oauthProvider: ProxyOAuthProvider;
    private isConnected = false;
    private resourceMetadata: OAuthProtectedResourceMetadata | undefined;

    constructor(config: Config) {
        this.config = config;
        this.oauthProvider = new ProxyOAuthProvider(config);
    }
    /**
     * Connect to the MCP server with OAuth authentication using protected resource metadata
     */
    async connect(): Promise<void> {
        try {
            logInfo('Discovering OAuth protected resource metadata...');

            // Discover protected resource metadata from the MCP server
            this.resourceMetadata = await discoverOAuthProtectedResourceMetadata(
                this.config.mcpServer.url,
                { protocolVersion: '2024-11-05' }
            );

            if (!this.resourceMetadata) {
                throw new Error('No OAuth protected resource metadata found');
            }

            if (this.resourceMetadata.resource != null && this.resourceMetadata.resource != '') {
                this.resourceMetadata.resource = '';
            }

            logInfo('OAuth protected resource metadata discovered:', {
                resource: this.resourceMetadata.resource,
                authorization_servers: this.resourceMetadata.authorization_servers,
                scopes_supported: this.resourceMetadata.scopes_supported
            });

            // Use configured scopes from env vars, with fallback to discovered scopes
            const requestedScopes = this.config.oauth.scopes.length > 0
                ? this.config.oauth.scopes
                : this.resourceMetadata.scopes_supported || [];

            logInfo(`Using OAuth scopes: ${requestedScopes.join(', ')}`);

            let authResult = await customAuth(this.oauthProvider, {
                serverUrl: this.config.mcpServer.url,
                scope: requestedScopes.join(' ')
            });

            // Handle the redirect case for interactive authentication
            if (authResult === 'REDIRECT') {
                logInfo('Waiting for OAuth authorization...');

                // Wait for the authorization code from the callback
                await this.waitForAuthorizationCode();

                // Complete the auth flow with the authorization code
                const authCode = this.oauthProvider.getAuthorizationCode();
                if (!authCode) {
                    throw new Error('No authorization code received');
                }

                authResult = await customAuth(this.oauthProvider, {
                    serverUrl: this.config.mcpServer.url,
                    authorizationCode: authCode,
                    scope: requestedScopes.join(' ')
                });

                this.oauthProvider.clearAuthorizationCode();
            }

            if (authResult !== 'AUTHORIZED') {
                throw new Error('OAuth authorization failed');
            }

            // Connect to the MCP server with the OAuth provider
            await this.connectToMcpServer();

            this.isConnected = true;
            logInfo('Successfully connected to MCP server with OAuth authentication');
        } catch (error) {
            logError('Failed to connect to MCP server:', error);
            throw error;
        }
    }

    /**
     * Wait for the authorization code from the OAuth callback
     */
    private async waitForAuthorizationCode(): Promise<void> {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (this.oauthProvider.getAuthorizationCode()) {
                    clearInterval(checkInterval);
                    clearTimeout(timeout);
                    resolve();
                }
            }, 1000);

            const timeout = setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('Authorization code timeout'));
            }, 300000); // 5 minutes
        });
    }

    /**
     * Connect to the MCP server using SSE with OAuth provider
     */
    private async connectToMcpServer(): Promise<void> {
        // Create SSE transport with OAuth provider
        const transport = new StreamableHTTPClientTransport(
            new URL(this.config.mcpServer.url),
            {
                authProvider: this.oauthProvider
            }
        );

        // Create MCP client
        this.mcpClient = new Client(
            {
                name: 'mcp-oauth-proxy-client',
                version: '1.0.0'
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {}
                }
            }
        );

        // Connect to the server
        await this.mcpClient.connect(transport);

        logInfo('Connected to MCP server via SSE with OAuth provider');
    }

    /**
     * Disconnect from the MCP server
     */
    async disconnect(): Promise<void> {
        if (this.mcpClient) {
            await this.mcpClient.close();
            this.mcpClient = null;
        }
        this.isConnected = false;
        logInfo('Disconnected from MCP server');
    }

    /**
     * Check if the client is connected
     */
    get connected(): boolean {
        return this.isConnected && this.mcpClient !== null;
    }

    /**
     * Get the connected MCP client instance
     */
    getClient(): Client | null {
        return this.mcpClient;
    }

    // MCP API methods that delegate to the connected client

    async listTools(): Promise<ListToolsResult> {
        if (!this.mcpClient) {
            throw new Error('MCP client not connected');
        }
        return await this.mcpClient.listTools();
    }

    async callTool(params: CallToolRequest['params']): Promise<CallToolResult> {
        if (!this.mcpClient) {
            throw new Error('MCP client not connected');
        }
        const result = await this.mcpClient.callTool(params);
        return result as CallToolResult;
    }

    async listResources(): Promise<ListResourcesResult> {
        if (!this.mcpClient) {
            throw new Error('MCP client not connected');
        }
        return await this.mcpClient.listResources();
    }

    async readResource(params: ReadResourceRequest['params']): Promise<ReadResourceResult> {
        if (!this.mcpClient) {
            throw new Error('MCP client not connected');
        }
        return await this.mcpClient.readResource(params);
    }

    async listPrompts(): Promise<ListPromptsResult> {
        if (!this.mcpClient) {
            throw new Error('MCP client not connected');
        }
        return await this.mcpClient.listPrompts();
    }

    async getPrompt(params: GetPromptRequest['params']): Promise<GetPromptResult> {
        if (!this.mcpClient) {
            throw new Error('MCP client not connected');
        }
        return await this.mcpClient.getPrompt(params);
    }
}