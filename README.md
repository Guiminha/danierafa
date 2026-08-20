# 💍 Site de Fotos do Casamento

Página única para os convidados enviarem fotos e vídeos tirados no dia do casamento, direto para o **MinIO** (object storage no seu VPS).

## Funcionalidades

- Capa com foto do casal, nomes e data
- Galeria estilo Instagram (grade 3 colunas, sem abrir as fotos)
- Botão de upload fixo no rodapé (mobile-first)
- Apenas fotos e vídeos são aceitos — qualquer outro arquivo é rejeitado (validado no servidor e pelo MinIO)
- Upload direto do celular para o MinIO via **presigned POST** (sem passar pelo servidor)
- Bucket privado: as fotos só são visíveis para quem tem o link do site

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie e edite o arquivo de ambiente:

   ```bash
   cp .env.example .env
   ```

   Preencha com os dados do seu MinIO:

   ```env
   PORT=3000
   MINIO_ENDPOINT=127.0.0.1        # IP ou domínio do MinIO
   MINIO_PORT=9000
   MINIO_USE_SSL=false             # true se usar HTTPS no MinIO
   MINIO_ACCESS_KEY=sua-access-key
   MINIO_SECRET_KEY=sua-secret-key
   MINIO_BUCKET=wedding            # bucket já criado no MinIO
   MINIO_PREFIX=uploads
   MAX_FILE_MB=200                 # tamanho máximo por arquivo
   URL_EXPIRY_SECONDS=604800       # validade das URLs da galeria (7 dias)
   ```

3. Rode localmente:

   ```bash
   npm start
   ```

4. Acesse `http://localhost:3000`

## Personalização

| O quê | Onde |
|---|---|
| Nomes dos noivos e data | `public/index.html` (linhas 13, 24 e 26) |
| Foto da capa | Substitua `public/img/cover.svg` por `public/img/cover.jpg` (tela cheia, recomenda-se ~1200px de largura) |

## Deploy no VPS (PM2 + Nginx + SSL)

1. Suba os arquivos para o VPS (ex.: `/var/www/wedding`).
2. Instale o PM2 e inicie:

   ```bash
   npm install
   npm install -g pm2
   pm2 start server.js --name wedding
   pm2 save
   pm2 startup
   ```

3. Nginx como proxy reverso (`/etc/nginx/sites-available/wedding`):

   ```nginx
   server {
       listen 80;
       server_name fotos.seusite.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           client_max_body_size 300m;
       }
   }
   ```

4. SSL com Let's Encrypt:

   ```bash
   sudo certbot --nginx -d fotos.seusite.com
   ```

> **Dica:** no `server_name` da Nginx use um subdomínio curto e fácil de digitar no celular (ex.: `fotos.anamaejoao.com`), e divulgue o link com um QR code impresso nos convites.

## Upload de vídeo: ajuste do Nginx

O upload vai direto do navegador para o MinIO (não passa pelo Nginx), mas se quiser liberar arquivos grandes na página, `client_max_body_size` acima cuida disso.

## Limitações conhecidas

- **HEIC/HEIF (iPhone):** chega íntegro no MinIO, mas nem todo navegador exibe na galeria — aparece como ícone de arquivo. O noivo pode baixar direto do MinIO.
- As URLs da galeria expiram (padrão 7 dias); ao reabrir o site, novas URLs são geradas automaticamente.

## Estrutura

```
├── server.js          # API (presigned URLs) + serve o frontend
├── public/
│   ├── index.html     # página única
│   ├── css/styles.css # mobile-first
│   ├── js/app.js      # galeria + upload
│   └── img/cover.svg  # placeholder da capa (trocável)
└── .env               # credenciais do MinIO
```