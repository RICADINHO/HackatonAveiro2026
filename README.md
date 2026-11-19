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

- Was created with `npm create vite@latest dot -- --template react-ts`
- `cd web/dot`
- `npm install`
- `npm run build` compila o frontend para `web/dist`.
- `npm run dev` inicia o Vite com proxy para a API local.
- `npm run deploy` publica o frontend no GitHub Pages.

Site available at: https://ricadinho.github.io/HackatonAveiro2026/

## Correr backend

   ```sh
   uv run --python .venv python -m server.app
   ```