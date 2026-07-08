# Bot WhatsApp para Cadastro de Cliente Caixa

## Intenção do projeto

Este projeto tem como objetivo automatizar o recebimento de documentos pelo
WhatsApp e transformar essas informações em dados estruturados para preencher o
cadastro de cliente no site da Caixa.

O fluxo esperado é:

1. O sistema conecta em uma conta do WhatsApp usando QR Code.
2. O usuário inicia uma remessa com uma mensagem padrão informando cliente e
   corretor.
3. O usuário envia documentos e mensagens adicionais pelo WhatsApp.
4. O sistema baixa os documentos, lê os textos e imagens, junta as mensagens
   adicionais e extrai as informações cadastrais.
5. As informações extraídas são normalizadas em um JSON com os campos usados no
   formulário da Caixa.
6. Com esse documento cadastral pronto, a automação planejada deve autenticar no
   site da Caixa, navegar até o formulário e preencher o cadastro.
7. Ao final, o corretor deve receber um e-mail de sucesso. Se algum passo falhar,
   o corretor deve receber um e-mail de falha com o motivo.

No estado atual do código, o bot já conecta ao WhatsApp, recebe documentos,
processa mensagens, usa OCR/IA para extrair dados e gera um relatório cadastral.
A automação do site da Caixa e o envio de e-mail estão previstos na arquitetura,
mas ainda não possuem uma implementação real: a automação atual usa
`NoopAutomationClient`.

## Mensagem padrão para iniciar

Para iniciar uma remessa, envie uma mensagem no WhatsApp com os dois campos:

```text
Novo cliente: Nome completo do cliente
Nome do corretor: Nome completo do corretor
```

Exemplo:

```text
Novo cliente: Maria Silva Santos
Nome do corretor: Joao Pereira
```

Depois disso, envie os documentos e mensagens adicionais. Quando terminar, envie:

```text
Finalizado
```

Ao receber `Finalizado`, o sistema espera a fila de documentos terminar e gera o
relatório cadastral com os dados extraídos.

## Modelo do JSON de cadastro

O sistema trabalha com um objeto JSON em que cada campo do formulário da Caixa é
uma chave, e cada valor é uma string. Quando uma informação não for encontrada, o
valor deve ficar vazio.

```json
{
  "CPF do Cliente": "",
  "Nome do Cliente Completo": "",
  "Declaração de Propósitos": "",
  "Movimentação de Conta de Depósito/Poupança": "",
  "Empréstimos/Financiamentos": "",
  "Financiamento Habitacional": "",
  "Investimentos": "",
  "Cartão de Crédito": "",
  "Seguros/Previdência Privada/Capitalização/Consórcios": "",
  "Operações Internacionais/Câmbio": "",
  "Nome do Cliente Reduzido": "",
  "Data de Nascimento": "",
  "Sexo": "",
  "Nacionalidade": "",
  "Naturalidade UF": "",
  "Naturalidade Município": "",
  "Nome do Pai": "",
  "Nome da Mãe": "",
  "Grau de Instrução": "",
  "PIS/NIS": "",
  "Tipo de Documento de Identificação": "",
  "Número da Carteira Nacional de Habilitação": "",
  "Órgão Emissor": "",
  "UF do Documento": "",
  "Data da 1ª Habilitação": "",
  "Data de Emissão": "",
  "Data Fim Validade": "",
  "Estado Civil": "",
  "Tipo de Ocupação": "",
  "Ocupação": "",
  "CEP": "",
  "Tipo de Logradouro": "",
  "Endereço": "",
  "Número": "",
  "Complemento": "",
  "Bairro": "",
  "UF do Endereço": "",
  "Município": "",
  "Tipo de Imóvel": "",
  "Ocupação do Imóvel": "",
  "Mês do Comprovante de Residência": "",
  "Ano do Comprovante de Residência": "",
  "Telefone Celular DDD": "",
  "Telefone Celular Número": "",
  "E-mail": "",
  "Característica da Renda": "",
  "Tipo de Fonte": "",
  "CPF/CNPJ da Fonte Pagadora": "",
  "Nome da Fonte Pagadora": "",
  "Ocupação da Renda Formal": "",
  "Data de Admissão": "",
  "Renda Bruta": "",
  "Renda Líquida": "",
  "Número de Dependentes": "",
  "Despesa Mensal com Aluguel": "",
  "Despesa Mensal com Condomínio": "",
  "Despesa Mensal com Pensão Alimentícia": "",
  "Agência de Relacionamento UF": "",
  "Agência de Relacionamento Município": "",
  "Código e Nome da Agência": ""
}
```

## IA e leitura de documentos

O projeto combina extração local com IA:

- OCR local opcional com Tesseract, habilitado por `OCR_PROVIDER=tesseract`.
- Extração por IA via OpenRouter, usando por padrão o modelo
  `google/gemini-2.5-flash`.
- Se `OPENROUTER_API_KEY` não estiver configurado, o sistema registra aviso e
  usa apenas a extração local.

A IA recebe textos extraídos dos documentos, imagens quando disponíveis e
mensagens adicionais da remessa. Ela deve responder somente JSON válido, usando
as mesmas chaves do modelo cadastral.

## O que o bot faz hoje

- Conecta no WhatsApp com Baileys.
- Mostra o QR Code no terminal e em uma página web local.
- Aceita documentos e imagens enviados durante uma remessa ativa.
- Ignora documentos quando não existe remessa iniciada.
- Registra mensagens adicionais enviadas durante a remessa.
- Salva documentos temporariamente em `tmp/uploads`.
- Envia documentos e relatórios para o storage configurado.
- Gera um relatório `.txt` com os campos cadastrais extraídos.
- Exibe documentos recebidos no painel web do QR Code.

## Stack

- Node.js
- TypeScript
- Baileys para WhatsApp
- Tesseract para OCR local
- OpenRouter para IA
- Supabase Storage
- Microsoft Graph API para OneDrive, fluxo pausado temporariamente
- Arquitetura em camadas com entrada MVC

## Como rodar em desenvolvimento

### 1. Instale as dependências

```bash
npm install
```

### 2. Crie o arquivo `.env`

Crie um arquivo `.env` na raiz do projeto. O fluxo principal salva documentos e
relatórios no Supabase Storage.

```env
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=docs-bot
SUPABASE_FOLDER=whatsapp
LOCAL_DOCUMENTS_MIRROR_ENABLED=false
WHATSAPP_ALLOWED_CHAT_NAME=docs_bot
QR_CODE_WEB_PORT=3334
FORM_SUBMISSION_HTTP_PORT=3335
OCR_PROVIDER=disabled
EFFECTUS_APP_BASE_URL=http://localhost:5173
```

Campos importantes:

- `WHATSAPP_ALLOWED_CHAT_NAME`: nome do grupo/chat que o bot deve aceitar.
- `WHATSAPP_ALLOWED_CHAT_ID`: opcional; se preenchido, restringe o bot a um chat
  específico do WhatsApp.
- `QR_CODE_WEB_PORT`: porta do painel web que mostra o QR Code e documentos.
- `FORM_SUBMISSION_HTTP_PORT`: porta da API de recebimento de formulários.
- `STORAGE_PROVIDER=supabase`: salva documentos e relatórios no bucket Supabase.
- `SUPABASE_BUCKET`: bucket onde os arquivos serão enviados.
- `SUPABASE_FOLDER`: pasta base dentro do bucket.
- `LOCAL_DOCUMENTS_MIRROR_ENABLED=false`: desliga a cópia local em pasta do PC.
- `OCR_PROVIDER=disabled`: deixa OCR desligado no primeiro teste.
- `EFFECTUS_APP_BASE_URL`: URL pública do sistema web para montar o link
  "Responder comentário" enviado no WhatsApp.

### 3. Rode o bot em modo dev

```bash
npm run dev
```

Esse comando executa `src/main.ts` com `tsx watch`. Sempre que o código mudar, o
processo reinicia automaticamente.

### 4. Conecte o WhatsApp pelo QR Code

Quando o bot iniciar, o QR Code aparece em dois lugares:

```text
Terminal
http://localhost:3334
```

Abra `http://localhost:3334` no navegador para ver o painel web. Esse painel
mostra o QR Code do WhatsApp e a lista de documentos recebidos na sessão.

No celular:

1. Abra o WhatsApp.
2. Vá em aparelhos conectados.
3. Escaneie o QR Code exibido no terminal ou no painel web.
4. Depois da conexão, envie mensagens no grupo/chat configurado.

### 5. Inicie uma remessa pelo WhatsApp

No chat permitido, envie:

```text
Novo cliente: Maria Silva Santos
Nome do corretor: Joao Pereira
```

Depois envie documentos, imagens ou mensagens adicionais. Para encerrar e gerar
o relatório cadastral, envie:

```text
Finalizado
```

### 6. Verifique o resultado

Durante a execução, acompanhe:

- logs no terminal;
- painel web em `http://localhost:3334`;
- arquivos temporários em `tmp/uploads`;
- documentos/relatórios enviados ao bucket Supabase configurado.

O fluxo de OneDrive/pasta local está pausado temporariamente.

## Configuração do OneDrive real, pausada

O trecho de OneDrive foi deixado comentado no código por enquanto. Quando esse
fluxo voltar, configure `ONEDRIVE_PROVIDER=graph` ou `STORAGE_PROVIDER=onedrive`
e informe as credenciais Microsoft:

```env
ONEDRIVE_PROVIDER=graph
STORAGE_PROVIDER=onedrive
ONEDRIVE_TENANT_ID=common
ONEDRIVE_CLIENT_ID=seu-client-id
ONEDRIVE_CLIENT_SECRET=seu-client-secret
ONEDRIVE_REFRESH_TOKEN=seu-refresh-token
ONEDRIVE_FOLDER=/docs
```

Para gerar o `ONEDRIVE_REFRESH_TOKEN`, configure esta redirect URI no app da
Microsoft:

```text
http://localhost:3333/auth/onedrive/callback
```

Depois rode:

```bash
npm run onedrive:auth
```

O script abre o fluxo de autenticação da Microsoft. Ao finalizar, ele imprime o
`ONEDRIVE_REFRESH_TOKEN`; copie esse valor para o `.env`.

Depois disso, rode novamente:

```bash
npm run dev
```

## Configuração de OCR e IA

Para habilitar OCR local com Tesseract:

```env
OCR_PROVIDER=tesseract
OCR_LANGUAGE=por
```

Para habilitar a extração com IA pelo OpenRouter:

```env
OPENROUTER_API_KEY=sua-chave
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Com `OPENROUTER_API_KEY` configurado, o sistema usa OpenRouter com o modelo
`google/gemini-2.5-flash` para ajudar a ler documentos e preencher o JSON
cadastral.

## Configuração do Supabase Storage

Configure o Supabase Storage:

```env
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_BUCKET=docs-bot
SUPABASE_FOLDER=whatsapp
LOCAL_DOCUMENTS_MIRROR_ENABLED=false
```

## Como rodar compilado

```bash
npm run build
npm start
```

## Scripts

- `npm run dev`: inicia o bot em modo desenvolvimento.
- `npm run build`: compila TypeScript para `dist`.
- `npm start`: roda a versão compilada.
- `npm run typecheck`: valida os tipos sem gerar arquivos.
- `npm run lint`: executa ESLint.
- `npm run onedrive:auth`: gera token de autenticação do OneDrive.

## Arquitetura

- `controllers`: entrada da aplicação e orquestração de mensagens.
- `use-cases`: regras de negócio e fluxos de processamento.
- `services`: serviços de aplicação, filas, arquivos, sessões e storage.
- `domain`: entidades, constantes e interfaces.
- `infra`: adaptadores concretos para WhatsApp, QR Code, storage, OCR, IA,
  OneDrive, logs e automação.
- `config`: leitura das variáveis de ambiente.
- `frontend`: painel web local para QR Code e documentos recebidos.

## Próximas implementações previstas

- Implementar cliente de automação real para o site da Caixa.
- Autenticar no portal da Caixa.
- Navegar até o formulário correto.
- Preencher o formulário usando o JSON cadastral extraído.
- Enviar e-mail de sucesso para o corretor.
- Enviar e-mail de falha quando login, navegação, leitura, storage ou cadastro
  falharem.
