export interface Config {
  oauth: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  };
  mcpServer: {
    url: string;
    name: string;
  };
  oauthServer: {
    port: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
