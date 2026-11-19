# Inventário urbano de Aveiro

## Correr localmente

O procedimento é o mesmo no portátil e no Skyloft. O FastAPI serve a aplicação compilada, a API em `/api` e os JPEG publicados em `/img`. O Supabase continua a gerir as contas e as sessões.

### 1. Preparar o ambiente

Instala Node.js 22.12 ou posterior, Python 3.12, uv e PostgreSQL com PostGIS. Podes usar uma instalação nativa de PostgreSQL ou o Docker. Em PowerShell, usa `npm.cmd` se a política local bloquear `npm.ps1`.

Da raiz do repositório, reutiliza a `.venv` dos datasets. Executa a primeira linha se o ambiente ainda não existir.

```sh
uv venv --python 3.12
uv pip install --python .venv -r requirements.txt
```

Cria ou edita o `.env` na raiz a partir de [`.env.example`](../.env.example). Define `DATABASE_URL` com a ligação ao PostgreSQL da máquina. `MAPILLARY_ACCESS_TOKEN` serve para os datasets. A API valida a sessão no Supabase e usa a chave publicável em código.

### 2. Preparar PostgreSQL e PostGIS

Numa instalação nativa, cria a base `aveiro` com o utilizador `aveiro` como proprietário. Instala PostGIS na instância e, como administrador de PostgreSQL, ativa a extensão na base.

```sql
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
```

Depois, aplica as migrações como proprietário da base, a partir da raiz do repositório.

```sh
psql -h 127.0.0.1 -U aveiro -d aveiro -f server/schema.sql
```

Se preferires Docker, o comando abaixo cria a base local com PostGIS. Escolhe uma palavra-passe e usa-a também em `DATABASE_URL`. Podes reutilizar um contentor existente com `docker start aveiro-postgis`.

```sh
docker run --name aveiro-postgis -e POSTGRES_USER=aveiro -e POSTGRES_PASSWORD=CHANGE_ME -e POSTGRES_DB=aveiro -p 127.0.0.1:5432:5432 -v aveiro-pgdata:/var/lib/postgresql/data -d postgis/postgis:16-3.7
docker exec aveiro-postgis mkdir -p /tmp/migrations
docker cp server/migrations/. aveiro-postgis:/tmp/migrations
docker cp server/schema.sql aveiro-postgis:/tmp/schema.sql
docker exec aveiro-postgis psql -U aveiro -d aveiro -f /tmp/schema.sql
```

A migração corre numa transação e pode ser executada de novo. Cria as tabelas no esquema `aveiro` e preserva os dados existentes. [Imagem Docker do PostGIS](https://github.com/postgis/docker-postgis)

### 3. Configurar contas no Supabase

1. Em **Connect** confirma o Project URL e a chave **Publishable**. Usa os mesmos valores em [`server/app/config.py`](app/config.py) e [`web/src/config.ts`](../web/src/config.ts).
2. Ativa o registo por email e palavra-passe. Em **Authentication → URL Configuration**, define o **Site URL** como `http://localhost:8000` e adiciona `http://localhost:8000/` e `http://localhost:5173/` em **Redirect URLs**. Se abrires a app no navegador com `127.0.0.1`, adiciona também `http://127.0.0.1:8000/` e `http://127.0.0.1:5173/`. [URLs de redirecionamento do Supabase](https://supabase.com/docs/guides/auth/redirect-urls)
3. Regista-te na app e confirma o email, se pedido. Para promover essa conta, um administrador copia o **User UID** em **Authentication → Users** e executa o código abaixo num ambiente administrativo com `@supabase/supabase-js` instalado e as três variáveis necessárias definidas no terminal. Guarda a chave secreta apenas nesse ambiente. Para retirar o papel de técnico, define `role: 'member'`. Termina e volta a iniciar sessão na app para atualizar os controlos visíveis. [API de administração do Supabase](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)

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

Para executar o exemplo, guarda-o temporariamente em `web/dot/atribuir-tecnico.mjs` e, com as variáveis definidas no terminal, corre `node atribuir-tecnico.mjs` nessa pasta.

### 4. Compilar e arrancar

```sh
cd web/dot
npm ci
npm run build
cd ../..
uv run --python .venv python -m server.app
```

Abre [a aplicação local](http://localhost:8000/). O build fica em `web/dist` e o processo escuta em `127.0.0.1:8000` por omissão. Usa `--host` e `--port` para mudar o endereço. Para desenvolver o frontend, deixa o FastAPI a correr na porta 8000 e executa `npm run dev` em `web/dot` noutro terminal. Abre [o Vite](http://localhost:5173/). O proxy do Vite encaminha `/api` e `/img` para o FastAPI.

A pasta de dados predefinida é `aveiro-data` na tua pasta pessoal. Tem `images/public` para imagens publicadas, `images/private` para pré-visualizações e `models` para modelos. Usa `--data-dir` ou altera `DATA_DIR` em `server/app/config.py` para escolher outra pasta. Em particular, se já tens imagens publicadas no Skyloft, aponta para a pasta que contém o diretório `images` existente. O servidor avisa se o caminho contiver OneDrive.

O servidor avisa ao arrancar enquanto o desfoque for experimental. Usa imagens de demonstração sem rostos nem matrículas visíveis. Para arrancar num endereço que não seja loopback, define explicitamente `ALLOW_PLACEHOLDER_PUBLIC=1` no ambiente do terminal. Em PowerShell usa `$env:ALLOW_PLACEHOLDER_PUBLIC = '1'`. Em Linux usa `export ALLOW_PLACEHOLDER_PUBLIC=1`.

## GitHub Pages e Caddy opcionais

Para manter um frontend alojado noutra origem, define `apiBase` em `web/src/config.ts` como, por exemplo, `https://api.example.com/api` e permite a origem do frontend em `CORS_ORIGINS` de `server/app/config.py`. Em `web/dot`, `npm run deploy` continua a construir para o caminho do GitHub Pages e a publicar. Mantém o URL do Pages entre os redirects do Supabase se o usares.

O [módulo NixOS](skyloft.nix) e o [Caddyfile](Caddyfile) continuam disponíveis para uma instalação com HTTPS. O módulo usa `/var/lib/aveiro-urban` como pasta de dados e lê `DATABASE_URL` do ficheiro de ambiente do serviço. O Caddy usa o domínio público e o diretório de imagens configurados. Enquanto o desfoque for experimental, limita o acesso público a imagens de demonstração.

## Verificação

- A pré-visualização privada expira ao fim de 30 minutos. Se faltarem metadados, indica latitude, longitude e direção em graus a partir do norte verdadeiro.
- O desfoque atua na metade inferior e o detetor devolve três caixas fixas. Os modelos reais podem substituir `anonymize` e `detect` em `server/imaging.py`.
- Os testes usam uma base PostGIS temporária e respostas simuladas do Supabase. Define `AVEIRO_TEST_DATABASE_URL` no terminal com uma ligação que possa criar bases e instalar PostGIS. Em PowerShell usa `$env:AVEIRO_TEST_DATABASE_URL = 'postgresql://...'`. Em Linux usa `export AVEIRO_TEST_DATABASE_URL='postgresql://...'`.

```sh
uv pip install --python .venv httpx
uv run --python .venv python -m unittest discover -s server/tests -v
```
