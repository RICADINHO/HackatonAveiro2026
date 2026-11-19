# Inventário urbano de Aveiro

## Primeira configuração

Estes passos fazem-se uma vez por máquina. O FastAPI serve a aplicação compilada, a API em `/api` e os JPEG publicados em `/img`. O Supabase continua a gerir as contas e as sessões. Para o dia a dia, vê [Correr de cada vez](../README.md#correr-de-cada-vez).

### 1. Preparar o ambiente

Precisas de Node.js 22.12 ou posterior, Python 3.12, uv e PostgreSQL 16 ou posterior com PostGIS. O passo 2 explica como ter o PostgreSQL com ou sem Docker.

#### Nix (recomendado)

Acrescenta Node.js e PostgreSQL com PostGIS ao `devShell` do `flake.nix` da raiz, ao lado de `uv` e `python312`:

```nix
packages = [
  pkgs.uv
  pkgs.git
  pkgs.python312
  pkgs.nodejs_22
  (pkgs.postgresql_16.withPackages (ps: [ ps.postgis ]))
];
```

Entra no shell com `nix develop` (ou deixa o direnv fazê-lo com `use flake`) e confirma `node --version`. Não definas `UV_PYTHON` no `shellHook`: o `uv pip` passa a apontar para o Python do `/nix/store`, que é só de leitura, e falha.

#### Outros ambientes

Instala Node.js, Python 3.12 e uv. Em PowerShell, usa `npm.cmd` se a política local bloquear `npm.ps1`.

#### Ambiente Python (todos)

Da raiz do repositório, reutiliza a `.venv` dos datasets. Executa a primeira linha se o ambiente ainda não existir.

```sh
uv venv --python 3.12
uv pip install --python .venv --torch-backend cpu -r requirements.txt
```

A `.venv` é específica de cada máquina e arquitetura. Se veio de outra máquina (por exemplo via OneDrive), apaga-a e cria-a de novo.

Cria ou edita o `.env` na raiz a partir de [`.env.example`](../.env.example). Define `DATABASE_URL` com a ligação indicada na opção que escolheres no passo 2. `MAPILLARY_ACCESS_TOKEN` serve para os datasets. A API valida a sessão no Supabase e usa a chave publicável em código.

### 2. Preparar PostgreSQL e PostGIS

Escolhe uma opção. Na opção A, a base de dados fica em `aveiro-data/postgres`, junto das imagens. Na opção B, fica num volume do Docker, fora de `aveiro-data`. A base e a pasta `aveiro-data` guardam coisas diferentes (dados estruturados e ficheiros de imagem), por isso copia-as sempre em conjunto.

#### Opção A: cluster local, sem Docker

Precisas dos programas `initdb`, `pg_ctl`, `createdb` e `psql` no `PATH`.

- **Nix:** já vêm no `nix develop`.
- **Debian/Ubuntu:** `sudo apt install postgresql-16 postgresql-16-postgis-3`. Os programas ficam em `/usr/lib/postgresql/16/bin`, que não está no `PATH`: acrescenta essa pasta ao `PATH`. O serviço do sistema que o apt arranca pode ficar parado ou ligado, porque aqui usamos a porta 5433.
- **macOS:** `brew install postgis` (instala também o PostgreSQL). Confirma com `initdb --version`.
- **Windows:** instala o PostgreSQL com o instalador da EDB e o PostGIS pelo Application Stack Builder, e acrescenta a pasta `bin` do PostgreSQL ao `PATH`. Usa o PowerShell.

Se o repositório estiver numa pasta sincronizada (OneDrive, por exemplo no Skyloft), não deixes `aveiro-data` lá dentro: o PostgreSQL pode corromper-se. Cria a pasta num disco local e liga-a: `mkdir -p ~/aveiro-data && ln -s ~/aveiro-data aveiro-data`. Se o sistema de ficheiros não aceitar ligações simbólicas, clona o repositório fora do OneDrive.

Da raiz do repositório, cria o cluster, arranca-o e prepara a base. A pasta `aveiro-data` é criada pelo `initdb`.

```sh
initdb -D aveiro-data/postgres -U aveiro --auth=trust --no-locale -E UTF8
pg_ctl -D aveiro-data/postgres -l aveiro-data/postgres.log -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=" start
createdb -h 127.0.0.1 -p 5433 -U aveiro aveiro
psql -h 127.0.0.1 -p 5433 -U aveiro -d aveiro -c "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public"
psql -h 127.0.0.1 -p 5433 -U aveiro -d aveiro -f server/schema.sql
```

No `.env`:

```
DATABASE_URL=postgresql://aveiro@127.0.0.1:5433/aveiro
```

O cluster aceita ligações sem palavra-passe, mas só escuta em `127.0.0.1`. Serve para desenvolvimento, não para uma máquina exposta. A migração corre numa transação e pode ser executada de novo.

#### Opção B: Docker

O comando abaixo cria a base local com PostGIS. Escolhe uma palavra-passe e usa-a também em `DATABASE_URL`. Podes reutilizar um contentor existente com `docker start aveiro-postgis`.

```sh
docker run --name aveiro-postgis -e POSTGRES_USER=aveiro -e POSTGRES_PASSWORD=CHANGE_ME -e POSTGRES_DB=aveiro -p 127.0.0.1:5432:5432 -v aveiro-pgdata:/var/lib/postgresql/data -d postgis/postgis:16-3.7
docker exec aveiro-postgis mkdir -p /tmp/migrations
docker cp server/migrations/. aveiro-postgis:/tmp/migrations
docker cp server/schema.sql aveiro-postgis:/tmp/schema.sql
docker exec aveiro-postgis psql -U aveiro -d aveiro -f /tmp/schema.sql
```

No `.env`:

```
DATABASE_URL=postgresql://aveiro:CHANGE_ME@127.0.0.1:5432/aveiro
```

A migração corre numa transação e pode ser executada de novo. Cria as tabelas no esquema `aveiro` e preserva os dados existentes. [Imagem Docker do PostGIS](https://github.com/postgis/docker-postgis)

#### Opção C: PostgreSQL já instalado como serviço

Cria a base `aveiro` com o utilizador `aveiro` como proprietário. Instala PostGIS na instância e, como administrador de PostgreSQL, ativa a extensão na base.

```sql
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
```

Depois, aplica as migrações como proprietário da base, a partir da raiz do repositório, e define `DATABASE_URL` com a ligação a essa instância.

```sh
psql -h 127.0.0.1 -U aveiro -d aveiro -f server/schema.sql
```

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

### 4. Compilar e arrancar pela primeira vez

```sh
cd web/dot
npm ci
npm run build
cd ../..
uv run --python .venv python -m server.app
```

Abre [a aplicação local](http://localhost:8000/). O build fica em `web/dist` e o processo escuta em `127.0.0.1:8000` por omissão. Usa `--host` e `--port` para mudar o endereço.

A pasta de dados predefinida é `aveiro-data` na raiz do repositório e está no `.gitignore`. Tem `images/public` para imagens publicadas, `images/private` para pré-visualizações, `models` para modelos e, na opção A, `postgres` para a base de dados. Usa `--data-dir` ou altera `DATA_DIR` em `server/app/config.py` para escolher outra pasta. Em particular, se já tens imagens publicadas no Skyloft, aponta para a pasta que contém o diretório `images` existente. O servidor avisa se o caminho contiver OneDrive.

O servidor avisa ao arrancar enquanto o desfoque for experimental. Usa imagens de demonstração sem rostos nem matrículas visíveis. Para arrancar num endereço que não seja loopback, define explicitamente `ALLOW_PLACEHOLDER_PUBLIC=1` no ambiente do terminal. Em PowerShell usa `$env:ALLOW_PLACEHOLDER_PUBLIC = '1'`. Em Linux usa `export ALLOW_PLACEHOLDER_PUBLIC=1`.

Na primeira pré-visualização, o servidor carrega `yolo/detector_3classes.pt` e analisa a imagem desfocada em CPU. As caixas mostram a classe e a confiança de cada deteção. Os sinais de trânsito e os contentores recebem rótulos genéricos nesta versão.

## GitHub
