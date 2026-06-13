import { QrCodePresenter } from '../../domain/interfaces/qr-code-presenter.interface.js';

export class CompositeQrCodePresenter implements QrCodePresenter {
  constructor(private readonly presenters: QrCodePresenter[]) {}

  show(qrCode: string): void {
    this.presenters.forEach((presenter) => presenter.show(qrCode));
  }

  clear(): void {
    this.presenters.forEach((presenter) => presenter.clear());
  }
}
