import { StorageProvider } from '../../domain/interfaces/storage.interface.js';

export interface OneDriveClientConfig {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  folder: string;
}

export class OneDriveClient implements StorageProvider {
  constructor(private readonly config: OneDriveClientConfig) {}

  async upload(file: Buffer, filename: string): Promise<string> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new Error('OneDrive credentials are required when ONEDRIVE_PROVIDER=graph');
    }

    const accessToken = await this.refreshAccessToken();
    const encodedPath = this.buildUploadPath(filename);
    const response = await fetch(`https://graph.microsoft.com/v1.0${encodedPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: new Blob([new Uint8Array(file)]),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OneDrive upload failed: ${response.status} ${body}`);
    }

    const result = (await response.json()) as { webUrl?: string; id?: string };
    return result.webUrl ?? result.id ?? filename;
  }

  private async refreshAccessToken(): Promise<string> {
    const tenant = this.config.tenantId ?? 'common';
    const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId ?? '',
        client_secret: this.config.clientSecret ?? '',
        refresh_token: this.config.refreshToken ?? '',
        grant_type: 'refresh_token',
        scope: 'Files.ReadWrite offline_access',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OneDrive token refresh failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { access_token?: string };

    if (!data.access_token) {
      throw new Error('OneDrive token response did not include access_token');
    }

    return data.access_token;
  }

  private buildUploadPath(filename: string): string {
    const folder = this.config.folder.replace(/^\/+|\/+$/g, '');
    const encodedSegments = [...folder.split('/').filter(Boolean), filename]
      .map(encodeURIComponent)
      .join('/');

    return `/me/drive/root:/${encodedSegments}:/content?@microsoft.graph.conflictBehavior=fail`;
  }
}
