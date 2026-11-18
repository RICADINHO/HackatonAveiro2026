console.log("mapa.js carregado");
console.log("Leaflet:", typeof L);

const mapa = L.map("mapa-aveiro").setView(
  [40.6405, -8.6538],
  12
);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(mapa);




  // Categorias e opções disponíveis
const categorias = [
  {
    nome: "Sinais de trânsito",
    opcoes: [
      { id: "stop", nome: "Stop" },
      { id: "cedencia", nome: "Cedência de passagem" },
      { id: "velocidade-30", nome: "Limite de 30 km/h" },
      { id: "velocidade-50", nome: "Limite de 50 km/h" },
      { id: "passadeira", nome: "Passagem para peões" }
    ]
  },
  {
    nome: "Ecopontos e contentores",
    opcoes: [
      { id: "subterraneo", nome: "Contentor subterrâneo" },
      { id: "ilha-reciclagem", nome: "Ilha de reciclagem" },
      { id: "indiferenciado", nome: "Contentor de indiferenciados" }
    ]
  },
  {
    id: "iluminacao",
    nome: "Iluminação pública"
  }
];

const filtrosSelecionados = new Map();
const botoesFiltro = new Map();

const categoriasContainer = document.querySelector("#categorias-filtros");
const selecionadosContainer = document.querySelector("#filtros-selecionados");

// Adiciona ou remove uma opção
function alternarFiltro(opcao) {
  if (filtrosSelecionados.has(opcao.id)) {
    filtrosSelecionados.delete(opcao.id);
  } else {
    filtrosSelecionados.set(opcao.id, opcao.nome);
  }

  atualizarFiltros();
}

// Cria um botão de seleção
function criarBotaoFiltro(opcao, classe) {
  const botao = document.createElement("button");

  botao.type = "button";
  botao.className = classe;
  botao.textContent = opcao.nome;
  botao.setAttribute("aria-pressed", "false");

  botao.addEventListener("click", () => alternarFiltro(opcao));

  botoesFiltro.set(opcao.id, botao);

  return botao;
}

// Cria as categorias no HTML
categorias.forEach((categoria, indice) => {
  // Categoria sem dropdown: iluminação
  if (!categoria.opcoes) {
    categoriasContainer.appendChild(
      criarBotaoFiltro(categoria, "btn btn-outline-primary")
    );

    return;
  }

  const dropdown = document.createElement("div");
  dropdown.className = "dropdown";

  const botao = document.createElement("button");
  botao.type = "button";
  botao.id = `categoria-filtro-${indice}`;
  botao.className = "btn btn-outline-primary dropdown-toggle";
  botao.textContent = categoria.nome;

  botao.setAttribute("data-bs-toggle", "dropdown");
  botao.setAttribute("data-bs-auto-close", "outside");
  botao.setAttribute("aria-expanded", "false");

  const lista = document.createElement("ul");
  lista.className = "dropdown-menu";
  lista.setAttribute("aria-labelledby", botao.id);

  categoria.opcoes.forEach(opcao => {
    const item = document.createElement("li");

    item.appendChild(
      criarBotaoFiltro(opcao, "dropdown-item")
    );

    lista.appendChild(item);
  });

  dropdown.append(botao, lista);
  categoriasContainer.appendChild(dropdown);
});

// Atualiza os botões e as etiquetas selecionadas
function atualizarFiltros() {
  selecionadosContainer.replaceChildren();

  botoesFiltro.forEach((botao, id) => {
    const selecionado = filtrosSelecionados.has(id);

    botao.classList.toggle("active", selecionado);
    botao.setAttribute("aria-pressed", String(selecionado));
  });

  filtrosSelecionados.forEach((nome, id) => {
    const etiqueta = document.createElement("button");

    etiqueta.type = "button";
    etiqueta.className = "btn btn-primary btn-sm";
    etiqueta.textContent = `${nome} ×`;
    etiqueta.setAttribute("aria-label", `Remover filtro: ${nome}`);

    etiqueta.addEventListener("click", () => {
      filtrosSelecionados.delete(id);
      atualizarFiltros();
    });

    selecionadosContainer.appendChild(etiqueta);
  });

  document.dispatchEvent(new CustomEvent("filtros-alterados", {
    detail: [...filtrosSelecionados.keys()]
  }));
}

atualizarFiltros();