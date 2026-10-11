// Ficha da peça: uma imagem só, com as vistas da camiseta (artes numeradas e com medida), a lista das artes e os tamanhos.
// É o que o cliente manda na conversa do WhatsApp junto com o pedido em texto. Fica guardada no aparelho (IndexedDB)
// até o pedido ser enviado ou a peça ser tirada. A janela "Meu pedido" do site lê de lá (src/novo/pedido.js).

const BANCO = 'mapra-pedido', LOJA = 'fichas';
const LARGURA = 1200, MARGEM = 44;
const TINTA = '#17181a', GIZ = '#4a4d51', AMARELO = '#ffe600', PRETO = '#0c0c0d', LINHA = '#d9dbd6';
const TITULO = '800 {px}px "Big Shoulders Display", "Arial Narrow", Arial, sans-serif';
const TEXTO = '{peso} {px}px "Instrument Sans", Arial, sans-serif';

const fonte = (modelo, px, peso = 500) => modelo.replace('{px}', px).replace('{peso}', peso);

function carrega(src) {
  return new Promise((ok, erro) => { const imagem = new Image(); imagem.onload = () => ok(imagem); imagem.onerror = () => erro(new Error('imagem da ficha')); imagem.src = src; });
}

// quebra um texto em linhas que cabem na largura dada (a fonte já deve estar posta no contexto)
function quebra(contexto, texto, largura) {
  const linhas = [];
  for (const paragrafo of String(texto).split('\n')) {
    let linha = '';
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = linha ? linha + ' ' + palavra : palavra;
      if (linha && contexto.measureText(tentativa).width > largura) { linhas.push(linha); linha = palavra; } else linha = tentativa;
    }
    linhas.push(linha);
  }
  return linhas;
}

/**
 * Desenha a ficha e devolve um Blob JPEG.
 * dados: { peca, cor: { nome, hex }, total, grade: [{ nome, itens: [[tamanho, quantidade]] }], aviso, cliente, vistas: [{ rotulo, src }], artes: [{ n, lugar, arquivo, medida, aspecto }] }
 */
export async function desenhaFicha(dados) {
  const vistas = await Promise.all(dados.vistas.map(async (vista) => ({ rotulo: vista.rotulo, imagem: await carrega(vista.src) })));
  const tela = document.createElement('canvas'); tela.width = LARGURA; tela.height = 5200;
  const c = tela.getContext('2d');
  const util = LARGURA - MARGEM * 2;
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, tela.width, tela.height);
  c.textBaseline = 'alphabetic';

  // cabeçalho preto
  c.fillStyle = PRETO; c.fillRect(0, 0, LARGURA, 132);
  c.fillStyle = AMARELO; c.font = fonte(TEXTO, 21, 700); c.fillText('MAPRA UNIFORMES', MARGEM, 48);
  c.fillStyle = '#ffffff'; c.font = fonte(TITULO, 58); c.fillText('FICHA DA PEÇA', MARGEM, 106);
  c.textAlign = 'right'; c.font = fonte(TEXTO, 21, 500); c.fillStyle = 'rgba(255,255,255,.82)';
  c.fillText(new Date().toLocaleDateString('pt-BR'), LARGURA - MARGEM, 48);
  c.fillText('Prévia para conferência', LARGURA - MARGEM, 80);
  c.textAlign = 'left';
  let y = 132 + 58;

  // a peça, a cor e o total
  c.fillStyle = TINTA; c.font = fonte(TITULO, 46);
  for (const linha of quebra(c, dados.peca.toUpperCase(), util)) { c.fillText(linha, MARGEM, y); y += 50; }
  y += 6;
  c.fillStyle = dados.cor.hex; c.fillRect(MARGEM, y - 24, 30, 30); c.strokeStyle = TINTA; c.lineWidth = 2; c.strokeRect(MARGEM, y - 24, 30, 30);
  c.fillStyle = TINTA; c.font = fonte(TEXTO, 27, 600);
  c.fillText('Cor: ' + dados.cor.nome + '   ·   Total: ' + dados.total + (dados.total === 1 ? ' peça' : ' peças'), MARGEM + 44, y);
  y += 34;
  if (dados.cliente) { c.fillStyle = GIZ; c.font = fonte(TEXTO, 23, 500); c.fillText(dados.cliente, MARGEM, y + 6); y += 34; }
  y += 14;

  // as vistas, duas por linha, cada uma com o nome embaixo
  const vao = 24, lado = (util - vao) / 2;
  vistas.forEach((vista, indice) => {
    const coluna = indice % 2, x = MARGEM + coluna * (lado + vao);
    if (indice && coluna === 0) y += lado + 52 + vao;
    c.drawImage(vista.imagem, x, y, lado, lado);
    c.fillStyle = TINTA; c.fillRect(x, y + lado, lado, 52);
    c.fillStyle = '#ffffff'; c.font = fonte(TITULO, 30); c.fillText(vista.rotulo.toUpperCase(), x + 16, y + lado + 37);
    c.strokeStyle = TINTA; c.lineWidth = 2; c.strokeRect(x, y, lado, lado + 52);
  });
  y += lado + 52 + 54;

  const secao = (nome) => {
    c.fillStyle = TINTA; c.font = fonte(TITULO, 34); c.fillText(nome.toUpperCase(), MARGEM, y);
    c.fillStyle = AMARELO; c.fillRect(MARGEM, y + 10, 84, 6);
    y += 54;
  };
  const paragrafo = (texto, peso = 500, cor = TINTA) => {
    c.fillStyle = cor; c.font = fonte(TEXTO, 26, peso);
    for (const linha of quebra(c, texto, util)) { c.fillText(linha, MARGEM, y); y += 36; }
  };

  // as artes, com o mesmo número que aparece na imagem
  secao('Artes');
  if (!dados.artes.length) paragrafo('Sem arte: camiseta lisa.');
  for (const arte of dados.artes) {
    c.fillStyle = AMARELO; c.beginPath(); c.arc(MARGEM + 19, y - 9, 19, 0, Math.PI * 2); c.fill();
    c.fillStyle = TINTA; c.font = fonte(TEXTO, 22, 700); c.textAlign = 'center'; c.fillText(String(arte.n), MARGEM + 19, y - 1); c.textAlign = 'left';
    c.font = fonte(TEXTO, 26, 700); c.fillText(arte.lugar + '  ·  ' + arte.medida, MARGEM + 52, y);
    y += 34;
    c.fillStyle = GIZ; c.font = fonte(TEXTO, 23, 500);
    for (const linha of quebra(c, [arte.arquivo, arte.aspecto].filter(Boolean).join('  ·  '), util - 52)) { c.fillText(linha, MARGEM + 52, y); y += 31; }
    y += 14;
  }
  y += 16;

  // tamanhos: um quadrinho por tamanho, com o tamanho em cima e a quantidade embaixo
  secao('Tamanhos');
  if (!dados.grade || !dados.grade.length) paragrafo('A definir.', 600);
  for (const grupo of dados.grade || []) {
    c.fillStyle = GIZ; c.font = fonte(TEXTO, 23, 600); c.fillText(grupo.nome, MARGEM, y); y += 16;
    const lw = 104, lh = 98, vao = 10;
    let x = MARGEM;
    for (const [tamanho, quantidade] of grupo.itens) {
      if (x + lw > LARGURA - MARGEM) { x = MARGEM; y += lh + vao; }
      c.fillStyle = '#eceee9'; c.fillRect(x, y, lw, 38);
      c.fillStyle = '#ffffff'; c.fillRect(x, y + 38, lw, lh - 38);
      c.strokeStyle = TINTA; c.lineWidth = 2; c.strokeRect(x, y, lw, lh);
      c.beginPath(); c.moveTo(x, y + 38); c.lineTo(x + lw, y + 38); c.stroke();
      c.textAlign = 'center'; c.fillStyle = TINTA;
      c.font = fonte(TEXTO, 24, 700); c.fillText(String(tamanho), x + lw / 2, y + 28);
      c.font = fonte(TITULO, 46); c.fillText(String(quantidade), x + lw / 2, y + 85);
      c.textAlign = 'left';
      x += lw + vao;
    }
    y += lh + 34;
  }
  y += 4;

  if (dados.aviso) { secao('Aviso do cliente'); paragrafo(dados.aviso); y += 24; }

  c.fillStyle = LINHA; c.fillRect(MARGEM, y, util, 2); y += 38;
  c.fillStyle = GIZ; c.font = fonte(TEXTO, 21, 500);
  for (const linha of quebra(c, 'Medidas e posições aproximadas, feitas pelo cliente no site. A Mapra confere a arte, a cor e o lugar antes de produzir.', util)) { c.fillText(linha, MARGEM, y); y += 30; }
  y += 22;

  // recorta na altura usada
  const pronta = document.createElement('canvas'); pronta.width = LARGURA; pronta.height = Math.ceil(y);
  pronta.getContext('2d').drawImage(tela, 0, 0);
  return new Promise((ok, erro) => pronta.toBlob((blob) => (blob ? ok(blob) : erro(new Error('ficha'))), 'image/jpeg', 0.9));
}

function abre() {
  return new Promise((ok, erro) => {
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => { if (!pedido.result.objectStoreNames.contains(LOJA)) pedido.result.createObjectStore(LOJA, { keyPath: 'id' }); };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => erro(pedido.error);
  });
}

/** Guarda a ficha e as logos originais de uma peça do pedido. registro: { id, nome, ficha: Blob, logos: [{ nome, blob }] } */
export async function guardaFicha(registro) {
  const banco = await abre();
  try {
    await new Promise((ok, erro) => {
      const troca = banco.transaction(LOJA, 'readwrite');
      troca.objectStore(LOJA).put({ ...registro, quando: Date.now() });
      troca.oncomplete = ok; troca.onerror = () => erro(troca.error); troca.onabort = () => erro(troca.error);
    });
  } finally { banco.close(); }
}
