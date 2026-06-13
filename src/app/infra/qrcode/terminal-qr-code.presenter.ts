import qrcode from 'qrcode-terminal';
import { QrCodePresenter } from '../../domain/interfaces/qr-code-presenter.interface.js';

export class TerminalQrCodePresenter implements QrCodePresenter {
  show(qrCode: string): void {
    qrcode.generate(qrCode, { small: true });
  }

  clear(): void {}
}
