export enum FileExtension {
  PDF = 'pdf',
  DOC = 'doc',
  DOCX = 'docx',
  XLS = 'xls',
  XLSX = 'xlsx',
  JPEG = 'jpeg',
  JPG = 'jpg',
  PNG = 'png',
  TXT = 'txt',
}

export const ALLOWED_FILE_EXTENSIONS = Object.values(FileExtension);

export const FILE_CONTENT_TYPES: Record<FileExtension, string> = {
  [FileExtension.PDF]: 'application/pdf',
  [FileExtension.DOC]: 'application/msword',
  [FileExtension.DOCX]:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  [FileExtension.XLS]: 'application/vnd.ms-excel',
  [FileExtension.XLSX]:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  [FileExtension.JPEG]: 'image/jpeg',
  [FileExtension.JPG]: 'image/jpeg',
  [FileExtension.PNG]: 'image/png',
  [FileExtension.TXT]: 'text/plain; charset=utf-8',
};

export const DEFAULT_FILE_CONTENT_TYPE = 'application/octet-stream';
