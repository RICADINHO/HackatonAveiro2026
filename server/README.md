# Inventário urbano no Skyloft

O GitHub Pages serve o frontend Vite. O Supabase gere as contas e sessões. No Skyloft, o FastAPI valida os JWT em `/auth/v1/user` do projeto Supabase e guarda os dados do inventário no PostgreSQL com PostGIS. As fotografias processadas ficam em disco. O Caddy faz o proxy HTTPS e confirma na API se a imagem está publicada antes de servir o JPEG.

## Supabase Auth

1. Ativa o registo por email e palavra-passe no projeto. Em **Authentication → URL Configuration**, usa `https://ricadinho.github.io/HackatonAveiro2026/` como URL do site e permite o redirecionamento para esse URL e para `http://localhost:5173/HackatonAveiro2026/`. Usa também `http://127.0.0.1:5173/HackatonAveiro2026/` se abrires o site por esse endereço.
2. Em **Connect**, copia o Project URL e a chave publicável. Preenche `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` no servidor e as respetivas variáveis `VITE_` no frontend.
3. Para atribuir o papel de técnico, um administrador pode executar este código numa ferramenta de administração que use `@supabase/supabase-js`. Usa `SUPABASE_SECRET_KEY` apenas nesse ambiente administrativo. Para retirar o acesso, define `role: 'member'`. A API consulta o papel em cada pedido autenticado. Para atualizar imediatamente os controlos visíveis na app depois de uma mudança de papel, termina e volta a iniciar sessão. [API de administração do Supabase](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)

```js
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { error } = await admin.auth.admin.updateUserById(process.env.TECHNICIAN_USER_ID, {
  app_metadata: { role: 'technician' },
})
if (error) throw error
```

## PostgreSQL e FastAPI

No checkout do Skyloft, usa o ambiente Python dos datasets. Se `.venv` ainda não existir, entra em `nix develop` e cria-a com `uv venv --python python3.12` para usar o Python do Nix. Instala as dependências em `requirements.txt`.

```sh
source .venv/bin/activate
uv pip install -r requirements.txt
```

Importa `server/skyloft.nix` na configuração do NixOS e indica o nome DNS que aponta para o Skyloft. A configuração prepara o utilizador e a base `aveiro`, adiciona PostGIS e lança a API na porta local 8000. Dá acesso de leitura ao checkout e à `.venv` para o utilizador de sistema `aveiro`.

```nix
{
  imports = [ /srv/aveiro-urban/server/skyloft.nix ];
  services.aveiroUrban = {
    enable = true;
    apiHost = "api.example.com";
    repository = "/srv/aveiro-urban";
  };
}
```

Cria `/etc/aveiro-urban.env` com as variáveis do servidor listadas em [`.env.example`](../.env.example). Neste módulo, usa `DATABASE_URL=postgresql:///aveiro?host=/run/postgresql` para autenticação local por *peer* e `IMAGE_DIR=/var/lib/aveiro-urban/images`. Define `PUBLIC_IMAGE_BASE_URL=https://<domínio-da-api>/img`. Confirma que `CORS_ORIGINS` inclui `https://ricadinho.github.io`, sem o caminho do projeto, mais as origens de desenvolvimento que usas. Mantém o ambiente do servidor fora do Git.

Depois de aplicar a configuração NixOS, instala a extensão com o administrador de PostgreSQL e aplica as migrações como o utilizador do serviço. Confirma primeiro que apontas para a base `aveiro` do Skyloft.

```sh
sudo -u postgres psql -d aveiro -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public'
sudo -u aveiro psql -d aveiro -f /srv/aveiro-urban/server/schema.sql
sudo systemctl restart aveiro-urban
```

A migração corre numa transação, pode voltar a ser executada e cria as tabelas no esquema `aveiro`. As tabelas de outros esquemas ficam intactas. Se houver inventário anterior noutro esquema, revê o mapeamento e importa os dados para `aveiro` separadamente. Confirma que o PostGIS está instalado em `public` se reutilizares uma base existente.

## Caddy e GitHub Pages

O módulo inclui `server/Caddyfile`. O domínio precisa de DNS apontado para o Skyloft e de acesso às portas 80 e 443 para o Caddy emitir o certificado. Se o servidor já gere a configuração Caddy separadamente, integra o bloco deste ficheiro uma vez e define `AVEIRO_API_DOMAIN` com o domínio. O Caddy serve `IMAGE_DIR/public` e a API reserva `IMAGE_DIR/private` para pré-visualizações. Os dois diretórios devem estar no mesmo sistema de ficheiros. Com o módulo, o Caddy tem leitura sobre a pasta pública e o serviço da API escreve em ambas as pastas. [Caddy `forward_auth`](https://caddyserver.com/docs/caddyfile/directives/forward_auth)

Cria ou edita `web/dot/.env.local` a partir de `web/.env.example`. Preenche as três variáveis e define `VITE_API_BASE_URL=https://<domínio-da-api>` sem `/img`. O URL da API é incorporado no build, por isso volta a publicar quando o alterares.

```sh
cd web/dot
npm ci
npm run build
npm run deploy
```

Para correr localmente, disponibiliza PostgreSQL com PostGIS e aplica `server/schema.sql`. Preenche o `.env` na raiz com o DSN, o URL e chave publicável do Supabase, `IMAGE_DIR` num diretório local e `PUBLIC_IMAGE_BASE_URL=http://127.0.0.1:8080/img`. Arranca o FastAPI e o Caddy em terminais separados. `AVEIRO_PUBLIC_IMAGE_DIR` deve ser o caminho absoluto de `IMAGE_DIR/public`. Define `VITE_API_BASE_URL=http://127.0.0.1:8080` e inicia o Vite em `web/dot` com `npm run dev` ou `npm.cmd run dev` em PowerShell.

```sh
python -m uvicorn server.app:create_app --factory --host 127.0.0.1 --port 8000
```

```sh
AVEIRO_API_DOMAIN=http://127.0.0.1:8080 AVEIRO_PUBLIC_IMAGE_DIR=/caminho/absoluto/images/public \
  caddy run --config server/Caddyfile --adapter caddyfile
```

## Processamento e testes

- A pré-visualização privada expira ao fim de 30 minutos. Quando faltam metadados, indica latitude, longitude e direção no formulário. A direção é medida em graus a partir do norte verdadeiro. A publicação grava o JPEG processado e o inventário e remove a pré-visualização.
- O desfoque experimental atua apenas na metade inferior da fotografia. O detetor devolve três caixas fixas. Usa fotografias de demonstração sem rostos ou matrículas visíveis enquanto estes placeholders estiverem ativos. Substitui `anonymize` e `detect` em `server/imaging.py` quando os modelos estiverem disponíveis.
- A distância de deduplicação é configurável por `DEDUP_RADIUS_METERS` e tem valor inicial de 50. O PostGIS projeta a estimativa com o rumo e a distância derivados da caixa, compara pela classe específica e atualiza as posições automáticas a partir das deteções associadas. Corrigir as coordenadas de um elemento fixa a sua posição até nova edição de um técnico. Corrigir as da câmara volta a calcular as estimativas dessa imagem.
- Para testar com PostGIS, instala `httpx` na `.venv` e define `AVEIRO_TEST_DATABASE_URL` com uma ligação de teste com autorização para criar uma base e instalar a extensão. O teste cria e remove apenas a sua base temporária e usa respostas simuladas do Supabase Auth.

```sh
uv pip install httpx
AVEIRO_TEST_DATABASE_URL=postgresql://postgres@localhost/postgres \
  python -m unittest discover -s server/tests -v
```
