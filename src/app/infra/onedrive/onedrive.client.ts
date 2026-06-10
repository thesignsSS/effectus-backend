import {
  StorageProvider,
  StorageUploadOptions,
} from '../../domain/interfaces/storage.interface.js';

export interface OneDriveClientConfig {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  folder: string;
}

export class OneDriveClient implements StorageProvider {
  constructor(private readonly config: OneDriveClientConfig) {}

  async upload(
    file: Buffer,
    filename: string,
    options?: StorageUploadOptions,
  ): Promise<string> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new Error('OneDrive credentials are required when ONEDRIVE_PROVIDER=graph');
    }

    const accessToken = await this.refreshAccessToken();
    await this.ensureFolderPath(accessToken, options);
    const encodedPath = this.buildUploadPath(filename, options);
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

  private async ensureFolderPath(
    accessToken: string,
    options?: StorageUploadOptions,
  ): Promise<void> {
    const folderSegments = this.buildFolderSegments(options);

    for (let index = 0; index < folderSegments.length; index += 1) {
      const currentPath = folderSegments.slice(0, index + 1);

      if (await this.folderExists(accessToken, currentPath)) {
        continue;
      }

      await this.createFolder(accessToken, folderSegments[index], currentPath.slice(0, -1));
    }
  }

  private async folderExists(
    accessToken: string,
    folderSegments: string[],
  ): Promise<boolean> {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0${this.buildItemPath(folderSegments)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OneDrive folder lookup failed: ${response.status} ${body}`);
    }

    return true;
  }

  private async createFolder(
    accessToken: string,
    folderName: string,
    parentSegments: string[],
  ): Promise<void> {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0${this.buildChildrenPath(parentSegments)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      },
    );

    if (response.status === 409) {
      return;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OneDrive folder creation failed: ${response.status} ${body}`);
    }
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

  private buildUploadPath(
    filename: string,
    options?: StorageUploadOptions,
  ): string {
    const encodedSegments = [
      ...this.buildFolderSegments(options),
      sanitizePathSegment(filename),
    ]
      .map(encodeURIComponent)
      .join('/');

    return `/me/drive/root:/${encodedSegments}:/content?@microsoft.graph.conflictBehavior=fail`;
  }

  private buildFolderSegments(options?: StorageUploadOptions): string[] {
    const folder = this.config.folder.replace(/^\/+|\/+$/g, '');
    const brokerFolder = sanitizePathSegment(options?.brokerName ?? 'Sem corretor');
    const clientFolder = sanitizePathSegment(options?.clientName ?? 'Sem cliente');

    return [
      ...folder.split('/').filter(Boolean).map(sanitizePathSegment),
      brokerFolder,
      clientFolder,
    ];
  }

  private buildItemPath(folderSegments: string[]): string {
    if (!folderSegments.length) {
      return '/me/drive/root';
    }

    return `/me/drive/root:/${encodeGraphPath(folderSegments)}`;
  }

  private buildChildrenPath(parentSegments: string[]): string {
    if (!parentSegments.length) {
      return '/me/drive/root/children';
    }

    return `/me/drive/root:/${encodeGraphPath(parentSegments)}:/children`;
  }
}

function encodeGraphPath(segments: string[]): string {
  return segments.map(encodeURIComponent).join('/');
}

function sanitizePathSegment(value: string): string {
  const sanitized = replaceControlCharacters(value)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'Sem nome';
}

function replaceControlCharacters(value: string): string {
  return [...value]
    .map((character) =>
      (character.codePointAt(0) ?? 0) < 32 ? '_' : character,
    )
    .join('');
}
