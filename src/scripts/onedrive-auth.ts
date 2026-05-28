import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const clientId = process.env.ONEDRIVE_CLIENT_ID;
const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
const tenantId = process.env.ONEDRIVE_TENANT_ID ?? 'common';
const redirectUri =
  process.env.ONEDRIVE_REDIRECT_URI ??
  'http://localhost:3333/auth/onedrive/callback';
const scopes = ['offline_access', 'Files.ReadWrite'];
const state = randomUUID();

if (!clientId || !clientSecret) {
  console.error(
    'Missing ONEDRIVE_CLIENT_ID or ONEDRIVE_CLIENT_SECRET in your .env file.',
  );
  process.exit(1);
}

const redirectUrl = new URL(redirectUri);
const port = Number(redirectUrl.port || 3333);
const callbackPath = redirectUrl.pathname;

const authUrl = new URL(
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
);

authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_mode', 'query');
authUrl.searchParams.set('scope', scopes.join(' '));
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', state);

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end('Missing request URL.');
    return;
  }

  const requestUrl = new URL(request.url, redirectUri);

  if (requestUrl.pathname !== callbackPath) {
    response.writeHead(404);
    response.end('Not found.');
    return;
  }

  const error = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');

  if (error) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Microsoft authorization failed: ${error}\n${errorDescription ?? ''}`);
    console.error('Microsoft authorization failed:', error, errorDescription);
    server.close();
    return;
  }

  if (requestUrl.searchParams.get('state') !== state) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Invalid OAuth state.');
    console.error('Invalid OAuth state received.');
    server.close();
    return;
  }

  const code = requestUrl.searchParams.get('code');

  if (!code) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Missing authorization code.');
    console.error('Missing authorization code.');
    server.close();
    return;
  }

  try {
    const token = await exchangeCodeForToken(code);

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`
      <h1>OneDrive autorizado</h1>
      <p>Volte ao terminal e copie o ONEDRIVE_REFRESH_TOKEN para o .env.</p>
    `);

    console.log('\nAdd this to your .env:\n');
    console.log(`ONEDRIVE_REFRESH_TOKEN=${token.refresh_token}`);
    console.log('\nKeep this value private.\n');
  } catch (exchangeError) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Failed to exchange authorization code. Check the terminal.');
    console.error(
      'Failed to exchange authorization code:',
      exchangeError instanceof Error ? exchangeError.message : exchangeError,
    );
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for Microsoft callback...');
  console.log(`Redirect URI must be configured exactly as: ${redirectUri}\n`);
});

async function exchangeCodeForToken(code: string): Promise<{ refresh_token: string }> {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: scopes.join(' '),
    }),
  });

  const body = (await response.json()) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.refresh_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        `Token request failed with status ${response.status}`,
    );
  }

  return { refresh_token: body.refresh_token };
}
