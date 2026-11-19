# HackatonAveiro2026

## Equipa Dot.

- Alano Baptista
- João Filipe
- Vicente Chã

# Python Env setup

- uv venv .venv --python python3.12
- source .venv/bin/activate
- uv pip install -r requirements.txt

# Vite + React + nodejs

- Foi criado com `npm create vite@latest dot -- --template react-ts`
- `cd web/dot`
- `npm install`
- `npm run build` compila o frontend para `web/dist`.
- `npm run dev` inicia o Vite com proxy para a API local.

## Variáveis do frontend

As variáveis do Vite ficam em [`web/.env`](web/.env) e o modelo está em [`web/.env.example`](web/.env.example). Não são lidas do `.env` da raiz.

```sh
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_API_BASE_URL=/api
VITE_CARTO_API_KEY=...
```

`VITE_CARTO_API_KEY` é a chave dos tiles do mapa (CARTO). É pública por desenho — vai no bundle do browser e só permite ler tiles. Cria uma em <https://carto.com/>. Sem chave, o mapa recua para os tiles do OpenStreetMap.

O `.env` da raiz continua a ser usado pelo backend Python (base de dados, Supabase Auth, modelos).

## Correr backend

```sh
uv run --python .venv python -m server.app
```

O FastAPI serve a app compilada em `web/dist`, a API em `/api` e as imagens em `/img`, em <http://127.0.0.1:8000>.
