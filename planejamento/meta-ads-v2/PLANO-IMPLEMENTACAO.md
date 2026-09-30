# Meta Ads v2: reimplementar do zero seguindo a SPEC Técnica v2

## Context

O usuário definiu que `~/Downloads/SPEC_Tecnica_v2_EffectusHub_Meta_Ads.pdf` é **o guia oficial**. A implementação que está na `develop` (formulário nativo da Meta que impulsiona um post existente, só o dono usa) é outro produto. O próprio Elias registrou esse gap em `effectus-api/docs/meta-ads.md` e deixou em aberto se a spec completa ainda valia. Agora a resposta é sim.

Decisões do usuário:
- **Jogar fora** a implementação atual.
- Implementar no **effectus-backend (bot)**.
- Acesso só para **dono/admin** da empresa.
- **Sem módulo de Imóveis por enquanto**: a Marina vai passar a descrição da atividade.
- CCA: seguir o que o PDF diz.

Resultado esperado:
- Conectar a conta Meta via OAuth e escolher a conta de anúncios, a Página e o Instagram.
- Criar a campanha em rascunho.
- Publicar Campaign > Ad Set > Creative > Ad em **PAUSED**, de forma idempotente e retomável.
- Ativar a campanha explicitamente, pausar e retomar.
- Landing page pública do EffectusHub que capta o lead com documentos, em storage privado com scan de malware e consentimento LGPD.
- Deduplicação do lead e roteamento assíncrono para a CCA, com retry e dead-letter.
- Webhooks e reconciliação.
- Métricas (insights).
- Auditoria.

### O que o PDF diz sobre CCA (e o que não diz)
- §1: associar o lead a "campanha, imóvel, corretor e CCA selecionada" e "encaminhar o lead para a CCA por fila assíncrona e acompanhar análise de crédito".
- §7.2: `campaigns.cca_id` é obrigatório.
- §14.2: enfileirar o roteamento e não expor dados internos da CCA à landing page.
- §15: o job `lead.route-to-cca` valida o lead e os documentos, resolve o `cca_id` da campanha, **cria a solicitação de análise**, envia os dados permitidos, registra protocolo e status, atualiza o CRM, e tem retry com backoff e dead-letter.
- **O PDF não diz como falar com a CCA** (API, email ou portal) nem o que compõe o cadastro da CCA.

Plano: o transporte fica atrás de uma interface `CcaDispatcher`. A implementação inicial é **por email**, usando o `gmail-smtp-email.service.ts` que já existe. A "solicitação de análise" vira uma **Proposta** `em_analise`, porque no sistema a análise de crédito já é a Proposta, com todos os status. Isso fica marcado como premissa a confirmar com Elias/Marina. Trocar para uma API no futuro significa só escrever outro dispatcher.

### Imóvel adiado
A campanha nasce com `property_id uuid null`, e o conteúdo que a landing page e o criativo precisam (título, descrição, imagens, cidade/UF, preço opcional) fica **na própria campanha**. Quando a especificação da Marina chegar, o módulo de Imóveis preenche o `property_id` e a campanha passa a herdar os dados, sem mudar o pipeline.

## Descobertas que moldam o desenho
- **Autenticação no bot é insegura.** `form-submission-http.server.ts:2994` (`isAuthorized`) aceita uma chave compartilhada que está exposta no bundle do front (`VITE_FORM_SUBMISSION_API_KEY`) e confia no `userId` que vem na query/body. O módulo novo **não usa isso**. Ele valida o JWT de sessão do Supabase (`auth.getUser(token)`) e resolve empresa, dono e admin pelo perfil, portando a lógica de `effectus-api/src/core/auth/supabase-auth.guard.ts`. Atende §19.
- **Não existe fila.** `document-processing-queue.service.ts` é só em memória. Vou criar uma fila durável em Postgres: tabela `background_jobs` + função SQL `claim_background_jobs` com `FOR UPDATE SKIP LOCKED`, chamada via `supabase.rpc`, e um worker no mesmo processo. Não precisa de infraestrutura nova.
- **Não existe framework de testes no bot.** Vou adicionar `vitest`, como no `effectus-api`.
- Dá pra reaproveitar só utilitários: `src/app/utils/token-cipher.ts` (AES-GCM), `supabase-storage.client.ts` (padrão de bucket), `gmail-smtp-email.service.ts`, `proposal-store` e `broker-client-store` (criar a proposta e o cliente) e o logger. Todo o resto de lead-ads é removido.

## Arquitetura (backend `effectus-backend`, branch `feat/meta-ads-v2` a partir de `develop`)

Módulo novo em `src/app/modules/meta-ads/`, separado do servidor monolítico:
- `domain/`: tipos, enums de status (§7) e o contrato `AdvertisingProvider` (§9: listAdAccounts, createCampaign, createAdSet, createCreative, createAd, pause, resume, getInsights, mais uploadImage, getObjectStatus, OAuth), `CcaDispatcher`, `MalwareScanner`.
- `infra/meta/meta-ads.provider.ts`: usa **`facebook-nodejs-business-sdk`** (§3), com `setDebug(false)`.
- `infra/meta/fake-ads.provider.ts`: para o dev sem app da Meta.
- `infra/supabase/*.repository.ts`: um repositório por agregado, sempre filtrando por `company_id`.
- `infra/queue/pg-job-queue.ts` + `worker.ts`: enqueue, claim, complete, fail com backoff exponencial e jitter, e estado `dead` ao passar do máximo de tentativas.
- `infra/scan/clamav.scanner.ts`: clamd via TCP INSTREAM; `noop.scanner.ts` quando `MALWARE_SCAN_PROVIDER=none`.
- `infra/cca/email-cca.dispatcher.ts`
- `application/`: casos de uso, um por operação (conectar, callback, escolher ativos, CRUD de rascunho, publicar, pausar, retomar, ativar, receber lead, rotear para CCA, sincronizar insights, processar webhook).
- `http/meta-ads.router.ts`: a autenticação por JWT fica aqui. Plugar em `form-submission-http.server.ts` **antes** do `isAuthorized` legado, no lugar do `leadAdsHttpHandler`.
- Composição em `src/server.ts` (substitui `buildLeadAdsService`).

### Modelo de dados (migration nova em `supabase/migrations/`)
- **Remoção:** `drop` de `leads`, `lead_ad_campaigns` e `meta_connections` antigas (só existe dado de teste, e só no dev).
- `meta_connections` (§7.1): `company_id`, `user_id`, `meta_user_id`, `access_token_encrypted`, `token_expires_at`, `ad_account_id`, `page_id`, `instagram_actor_id`, `scopes jsonb`, `status` (CONNECTED, EXPIRED, REVOKED, ERROR). Índice único parcial para 1 conexão ativa por empresa.
- `oauth_states`: `state_hash`, `company_id`, `user_id`, `expires_at`, `used_at`. Uso único, TTL de 10 minutos (§19).
- `ad_campaigns` (§7.2): `company_id`, `property_id null`, `broker_id` (profile da empresa), `cca_id`, `provider='META'`, `name`, `objective`, `daily_budget`/`lifetime_budget` em centavos com `currency`, `start_at`/`end_at`, `status` (DRAFT, READY, PUBLISHING, ACTIVE, PAUSED, FINISHED, REJECTED, ERROR, ARCHIVED), `targeting jsonb` (opções de negócio), `placements` (auto), `special_ad_categories text[]`, os campos de criativo (`headline`, `primary_text`, `description`, `call_to_action`, `media_asset_id`, `landing_title`/`landing_description`/cidade/UF/preço), os `meta_*_id`, `meta_image_hash`, `public_token` (32 bytes base64url, único), `last_sync_at`, `rejection_reason`.
- `ad_campaign_media`: imagem do criativo no bucket privado `ad-media`, com `image_hash` da Meta depois do upload.
- `campaign_publish_attempts` (§7.3): `idempotency_key` único, `step`, `request_summary`, `provider_object_id`, `status`, `error_code`/`error_message`.
- `ccas`: `company_id`, `nome`, `email`, `ativo` (cadastro mínimo exigido pelo `cca_id`).
- `campaign_leads` (§7.4, nome novo para não colidir): `company_id`, `campaign_id`, `property_id`, `broker_id`, `cca_id`, `nome`, `email`, `telefone`, `cpf_hash`, `source='META'`, `utm_*`, `status` (NEW, ROUTING, SENT_TO_CCA, ROUTING_FAILED, DUPLICATE…), `duplicate_of`, `proposal_id`, `cca_protocol`.
- `lead_documents`: `storage_key` no bucket privado `lead-documents`, `mime_type` detectado pelo conteúdo, `size`, `malware_scan_status` (PENDING, CLEAN, INFECTED, ERROR).
- `lead_consents`: `consent_type`, `text_version`, `accepted_at`, `ip_hash`, `user_agent`.
- `campaign_insights`: `campaign_id` + `date` únicos, `spend`, `impressions`, `reach`, `clicks`, `ctr`, `cpc`, mais `raw jsonb` (§17).
- `meta_webhook_events`: `event_hash` único para dedup, `payload` sanitizado, `processed_at`, `expires_at` para retenção (§16).
- `audit_logs`: `company_id`, `actor_user_id`, `action`, `entity`, `entity_id`, `metadata` (§19).
- `background_jobs`: `queue`, `payload`, `status`, `attempts`, `max_attempts`, `run_at`, `locked_at`, `last_error`, `idempotency_key` único. Mais a função `claim_background_jobs`.
- RLS habilitada em todas as tabelas, sem policies para `anon`/`authenticated`: o acesso é só pela service role do backend, igual ao padrão atual. Isso evita repetir o bug do `proposal_email_messages` sem RLS.

### Endpoints
Nomes exatamente como na spec. O papel dono/admin é obrigatório em todos, menos os públicos.
- §6: `GET /api/integrations/meta/connect`, `GET /api/integrations/meta/callback` (público, valida o state), `GET /api/integrations/meta/ad-accounts`, `PUT /api/integrations/meta/ad-account`, `DELETE /api/integrations/meta`. Mais `GET /api/integrations/meta` (status) e `GET /api/integrations/meta/pages` (Página e Instagram elegíveis). O `PUT` valida que a conta está na lista retornada pela Meta.
- §8: `POST/PUT/GET /api/campaigns`, `PUT /api/campaigns/:id/creative`, `POST /api/campaigns/:id/media`, `POST /api/campaigns/:id/publish` (enfileira), `POST /pause`, `POST /resume`, `POST /activate` (ação explícita e auditada), `GET /api/campaigns/:id/metrics`.
- CRM: `GET /api/leads`, `GET /api/leads/:id`, `GET /api/leads/:id/documents/:docId` (URL assinada curta, com auditoria), `CRUD /api/ccas`, `GET /api/brokers` (profiles da empresa, para escolher o `broker_id`).
- Públicos: `GET /public/campaigns/:publicToken` (só dados de exibição, nada da CCA) e `POST /public/campaigns/:publicToken/leads` (multipart, parseado com `busboy`).
- §16: `GET/POST /webhooks/meta`. Valida `x-hub-signature-256` com `META_APP_SECRET` e o verify token, grava em `meta_webhook_events` e enfileira. Responde 200 rápido.

### Pipeline de publicação (§11), job `campaign.publish`
Passos 1 a 3: validar tenant, conexão CONNECTED, ativos, criativo, URL, orçamento, datas e categoria especial (`HOUSING` por padrão, configurável via `META_SPECIAL_AD_CATEGORIES`; segmentações restritas bloqueadas conforme a categoria).

Passos 4 a 8: para cada etapa (CAMPAIGN, ADSET, CREATIVE, AD), **se o `meta_*_id` já existe, pula**. Caso contrário, registra a tentativa (`idempotency_key = campaignId:step:revision`), chama o provider com `status: PAUSED`, e persiste o id imediatamente.
- CREATIVE: faz upload da imagem (`adimages` → `image_hash`) com `object_story_spec` usando `page_id`, `instagram_actor_id` e link = URL da landing com UTMs (§13.2).

Passos 9 e 10: consultar os objetos criados para confirmar e marcar a campanha como READY/PAUSED. Falha no meio deixa ERROR com o id parcial salvo, e o retry retoma do ponto onde parou. O `/activate` só roda a partir de READY/PAUSED.

### Captura do lead (§14) e CCA (§15)
Fluxo do `POST` público:
1. Rate limit por IP (em memória, janela deslizante), mais honeypot e tempo mínimo de preenchimento.
2. Validar token, campanha ACTIVE ou PAUSED e campos obrigatórios.
3. Documentos: tamanho máximo, MIME por *magic bytes* (pdf, jpg, png) e armazenamento em `lead-documents/{company}/{lead}/…`.
4. Consentimento com `text_version`.
5. Dedup: mesmo telefone, email ou `cpf_hash` na mesma empresa em até N dias → `DUPLICATE`, ligado ao lead original.
6. Enfileirar `lead.scan-documents` e `lead.route-to-cca`.
7. Responder 201 genérico.

`lead.route-to-cca`:
- Espera todos os documentos ficarem CLEAN; se algum der INFECTED, bloqueia e marca.
- Resolve o `cca_id`.
- Cria a Proposta `em_analise`, com cliente, dados e documentos, via `ProposalStore`/`BrokerClientStore`, e o corretor = `broker_id`.
- Chama `CcaDispatcher.send`, que por email usa os documentos como anexo e o `message-id` como protocolo.
- Grava `cca_protocol`/`proposal_id` e o status SENT_TO_CCA.
- Idempotente pela chave `leadId`. Tem backoff; depois de 5 tentativas vai para `dead` e para o status ROUTING_FAILED, que aparece no CRM para atendimento manual.

### Jobs periódicos (agendador simples no worker)
- `insights.sync` a cada 6 horas, para campanhas ACTIVE ou PAUSED.
- `campaigns.reconcile` diário (status real na Meta: REJECTED, FINISHED).
- `connections.check` (token expirando: EXPIRED, e o front pede reconexão).
- `retention.purge` (payloads de webhook e, conforme a política, leads e documentos).

### Erros (§20)
A classe `MetaApiError` mapeia o código da Meta para AUTH_EXPIRED (conexão vira EXPIRED), PERMISSION_DENIED, RATE_LIMIT (retry), VALIDATION_ERROR (volta o campo para o front), META_REJECTED (grava o motivo original), NETWORK e PARTIAL_PUBLISH. Cada requisição e cada job tem um `correlationId` no log. Logs nunca contêm token, header Authorization ou App Secret.

### Env (§4, com os nomes da spec)
- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_GRAPH_API_VERSION`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `META_LOGIN_CONFIG_ID`, `META_SPECIAL_AD_CATEGORIES`.
- Módulo: `ADS_PROVIDER=disabled|fake|meta`, `PUBLIC_LANDING_BASE_URL`, `MALWARE_SCAN_PROVIDER=none|clamav`, `CLAMAV_HOST`/`PORT`, `LEAD_DOCUMENT_MAX_MB`.
- As `META_*` antigas saem.
- Escopos OAuth: `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement` (§5; sai `leads_retrieval`).
- O `docker-compose.yml` ganha um serviço `clamav` opcional (profile).

## Frontend (`migrations/bot-rafael-app`, mesma branch)
- **Remover:** `src/pages/captacao/**`, as rotas `/captacao*` e `CompanyOwnerRoute`, se ficar sem uso.
- **Cliente novo:** `src/lib/adsApi.ts` com `Authorization: Bearer <session.access_token>` do Supabase, **sem** `x-api-key`. A URL base é derivada de `VITE_FORM_SUBMISSION_API_URL`, como o `captacaoApi.ts` fazia.
- **Guarda:** `OwnerOrAdminRoute`, usando o `/me`.
- **Páginas:**
  - `/anuncios`: lista com status, gasto e leads, mais um card da integração Meta (conectar, escolher conta de anúncios, Página e Instagram, reconectar quando EXPIRED).
  - `/anuncios/nova` e `/anuncios/:id/editar`: wizard do rascunho com objetivo, orçamento diário ou total, período, público (cidade/raio e idade só quando permitido), posicionamento automático, criativo (headline, texto, descrição, CTA, imagem), conteúdo da landing, corretor responsável e CCA. Deixa claro que o orçamento é cobrado pela Meta, não pelo EffectusHub (§18).
  - `/anuncios/:id`: status, ids externos, publicar, ativar, pausar e retomar, tentativas de publicação com erro e métricas.
  - `/leads`: lista e detalhe, com documentos por URL assinada e o status de roteamento para a CCA.
  - `/ccas`: cadastro.
- **Landing pública:** `/i/:publicToken`, fora do `ProtectedRoute` e antes do `*`. Mostra o conteúdo, tem formulário com upload, checkbox de consentimento com o texto versionado e honeypot.
- Seguir os padrões de `src/pages/propostas/lib/proposalsApi.ts` e os componentes existentes.

## Ordem de execução (§24), com um commit por etapa
1. Remoção do código e das tabelas antigas + migration nova + fila Postgres + autenticação JWT + vitest.
2. Provider (SDK real e fake) + OAuth (connect, callback com state de uso único) + `meta_connections` + escolha de conta e ativos, com testes.
3. Rascunho de campanha + upload de mídia + pipeline de publicação idempotente em PAUSED + activate, pause e resume. Testes de idempotência e de retomada após falha.
4. Landing pública + lead + documentos + scan + consentimento + dedup.
5. CCA (cadastro + dispatcher por email + Proposta) + job de roteamento com retry e dead-letter.
6. Webhooks + insights + reconcile + auditoria.
7. Frontend completo (em paralelo a partir da etapa 2).
8. Hardening: rate limit, logs sem PII, retenção e checagem de isolamento entre tenants.

No fim, atualizar `docs/ESTADO-ATUAL.md` do front e avisar o Elias para atualizar o `effectus-api/docs/meta-ads.md`, cuja pergunta da seção 3.5 fica respondida.

## Verificação
- **Testes (vitest) do módulo:**
  - state de uso único e expirado;
  - `PUT ad-account` recusa conta que não está na lista;
  - publish repetido não duplica;
  - falha após CAMPAIGN retoma no ADSET;
  - validação de orçamento e datas;
  - lead com arquivo inválido (MIME falso) é bloqueado;
  - dedup;
  - roteamento para CCA com sucesso, retry e dead;
  - tenant A recebe 404 para recurso do tenant B;
  - token nunca aparece em log (spy no logger).
- Mais `npm run typecheck`, `npm run lint` e `npm run build`.
- **Local:** Supabase local ou banco de dev + `ADS_PROVIDER=fake`, fluxo completo pelo front com o portal do Maestri: conectar, criar rascunho, publicar (PAUSED), ativar, abrir `/i/:token`, enviar o lead com PDF, ver o lead, a Proposta criada e o email na caixa de teste.
- **Dev (VPS):** PR para `develop` (autodeploy só do dev), migration aplicada no banco de dev e env via API do Dokploy. Repetir o roteiro com o usuário `diego.leads@effectuscb.com`.
- **Sandbox Meta (§21):** quando o app Meta existir, `ADS_PROVIDER=meta` contra uma conta de anúncios Sandbox, conferindo a estrutura criada em PAUSED no Ads Manager.
- Produção fica fora deste plano (exige App Review e uma decisão separada).

## Premissas a confirmar (não bloqueiam o início)
- Transporte até a CCA = email + Proposta `em_analise` (o PDF não especifica).
- Imóvel virá da especificação da Marina; até lá o conteúdo fica na campanha.
- Retenção de leads e documentos: padrão proposto de 24 meses, configurável.
