import { ImapFlow } from 'imapflow';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ProposalStore } from '../domain/interfaces/proposal-store.interface.js';
import { Logger } from '../domain/interfaces/logger.interface.js';

type Config = { user?: string; appPassword?: string; supabaseUrl?: string; serviceRoleKey?: string };

export class ProposalEmailReplySyncService {
  private readonly client: SupabaseClient | null;
  private lastRun = '';
  constructor(private readonly config: Config, private readonly proposalStore: ProposalStore, private readonly logger: Logger) {
    this.client = config.supabaseUrl && config.serviceRoleKey ? createClient(config.supabaseUrl, config.serviceRoleKey) : null;
  }

  start(): void {
    if (!this.isConfigured()) return;
    setInterval(() => void this.runIfScheduled(), 60_000).unref();
    void this.runIfScheduled();
  }

  async trackSent(input: { proposalId: string; brokerUserId: string; recipients: string[]; subject: string; messageIds: string[] }): Promise<void> {
    if (!this.client) return;
    await this.client.from('proposal_email_messages').upsert(
      input.messageIds.map((messageId, index) => ({ proposal_id: input.proposalId, broker_user_id: input.brokerUserId, message_id: messageId, recipient: input.recipients[index] ?? input.recipients[0], subject: input.subject })),
      { onConflict: 'message_id' },
    );
  }

  private isConfigured() { return Boolean(this.config.user && this.config.appPassword && this.client); }
  private async runIfScheduled(): Promise<void> {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts();
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    const key = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())}-${hour}`;
    if (minute !== '00' || !hour || !['10','11','12','13','14','15','16','17'].includes(hour) || this.lastRun === key) return;
    this.lastRun = key;
    await this.sync();
  }

  private async sync(): Promise<void> {
    if (!this.client || !this.config.user || !this.config.appPassword) return;
    const imap = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: this.config.user, pass: this.config.appPassword } });
    try {
      await imap.connect();
      const lock = await imap.getMailboxLock('INBOX');
      try {
        const uids = await imap.search({ seen: false }, { uid: true });
        if (!uids || uids.length === 0) return;
        for await (const message of imap.fetch(uids, { uid: true, source: true, envelope: true })) {
          const raw = message.source?.toString('utf8') ?? '';
          const replyTo = message.envelope?.inReplyTo ?? raw.match(/^In-Reply-To:\s*(.+)$/im)?.[1]?.trim();
          if (!replyTo) continue;
          const { data } = await this.client.from('proposal_email_messages').select('proposal_id, broker_user_id').eq('message_id', replyTo).is('replied_at', null).maybeSingle();
          if (!data) continue;
          const body = raw.split(/\r?\n\r?\n/, 2)[1]?.replace(/\r/g, '').split(/^On .+wrote:$/m)[0]?.trim() ?? '';
          if (!body) continue;
          await this.proposalStore.appendAuditComment({ proposalId: data.proposal_id, actorUserId: data.broker_user_id, actorRole: 'admin', actorName: 'Resposta por e-mail', scope: 'proposal', message: `Resposta recebida de ${message.envelope?.from?.[0]?.address ?? 'destinatário'} em ${new Date().toLocaleString('pt-BR')}:\n\n${body}` });
          await this.client.from('proposal_email_messages').update({ replied_at: new Date().toISOString() }).eq('message_id', replyTo);
          await imap.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
        }
      } finally { lock.release(); }
    } catch (error) { this.logger.error('Falha ao sincronizar respostas de e-mail', { error: error instanceof Error ? error.message : String(error) }); }
    finally { await imap.logout().catch(() => undefined); }
  }
}
