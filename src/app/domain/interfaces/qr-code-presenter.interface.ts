export interface QrCodePresenter {
  show(qrCode: string): void;
  clear(): void;
}
