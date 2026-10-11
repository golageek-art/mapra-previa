// Mapra, visual novo: cabeçalho fixo. Mede a altura dele (para os links de seção não caírem atrás) e, no celular,
// esconde o menu depois que a pessoa rola a página, para sobrar tela. Sem bibliotecas.
(function () {
  'use strict';
  var fixo = document.querySelector('.fixo');
  if (!fixo) return;

  function mede() { document.documentElement.style.setProperty('--fixo-h', fixo.offsetHeight + 'px'); }
  if ('ResizeObserver' in window) new ResizeObserver(mede).observe(fixo);
  else window.addEventListener('resize', mede);
  mede();

  // liga depois de 140 px e só desliga abaixo de 60: a folga evita o cabeçalho ficar abrindo e fechando no limite
  var rolou = false;
  function ve() {
    var y = window.pageYOffset;
    var agora = rolou ? y > 60 : y > 140;
    if (agora !== rolou) { rolou = agora; fixo.classList.toggle('rolou', rolou); }
  }
  window.addEventListener('scroll', ve, { passive: true });
  ve();
})();
// Mapra, visual novo: ficha da peça (cor, modelo, marca, tamanhos e logo do visitante). Sem bibliotecas; nada sai do aparelho.
// Cada [data-mostruario] guarda o que o visitante escolheu em el.estado e avisa quem quiser ouvir com o evento "mostruario:mudou"
// (veja PLANO.md, seção 3.4):  el.estado = { cor: "Azul Royal", marca: ["Peito esquerdo"], tam: { "Tradicional M": 10 }, qtd: 10 }
(function () {
  'use strict';
  var raiz = document.documentElement;
  var NUMERO = raiz.dataset.zap;

  function zap(msg) { return 'https://wa.me/' + NUMERO + '?text=' + encodeURIComponent(msg); }
  function pecas(n) { return n + (n === 1 ? ' peça' : ' peças'); }
  function inteiro(texto) { var n = parseInt(texto, 10); return n > 0 ? n : 0; }
  function claridade(hex) {
    var n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  /* "Tradicional P" 5, "Tradicional M" 10, "Feminina P" 3  ->  "Tradicional P 5, M 10; Feminina P 3" */
  function textoTamanhos(tam) {
    var grupos = [];
    Object.keys(tam).forEach(function (chave) {
      var corte = chave.lastIndexOf(' ');
      var modelagem = chave.slice(0, corte);
      var grupo = grupos.filter(function (g) { return g.nome === modelagem; })[0];
      if (!grupo) { grupo = { nome: modelagem, itens: [] }; grupos.push(grupo); }
      grupo.itens.push(chave.slice(corte + 1) + ' ' + tam[chave]);
    });
    return grupos.map(function (g) { return g.nome + ' ' + g.itens.join(', '); }).join('; ');
  }

  document.querySelectorAll('[data-mostruario]').forEach(function (m) {
    var svg = m.querySelector('.pecas');
    var nomeCor = m.querySelector('[data-nome-cor]');
    var rotulo = m.querySelector('[data-rotulo-peca]');
    var botaoZap = m.querySelector('[data-zap-mostruario]');
    var form = m.querySelector('[data-add-pedido]');
    var campoQtd = m.querySelector('input[name="qtd"]');
    var retalhos = Array.prototype.slice.call(m.querySelectorAll('.cartela .retalho'));
    var posicoes = Array.prototype.slice.call(m.querySelectorAll('button[data-pos]'));
    var tamanhos = Array.prototype.slice.call(m.querySelectorAll('input[data-tam]'));
    var escolhido = m.querySelector('.cartela .retalho[aria-pressed="true"]');
    var cor = escolhido ? escolhido.dataset.cor : '';
    var giro = null;

    // refaz m.estado a partir da tela; se há tamanhos preenchidos, a soma vira a quantidade e o campo fica só para leitura
    function sincroniza() {
      var tam = {};
      var soma = 0;
      tamanhos.forEach(function (c) {
        var n = inteiro(c.value);
        if (n) { tam[c.dataset.tam] = n; soma += n; }
      });
      if (campoQtd) {
        if (soma > 0) campoQtd.value = soma;
        campoQtd.readOnly = soma > 0;
      }
      m.estado = {
        cor: cor,
        marca: posicoes
          .filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; })
          .map(function (b) { return b.textContent; }),
        tam: tam,
        qtd: campoQtd ? inteiro(campoQtd.value) : 0
      };
    }

    // página de produto: o mesmo formato da mensagem do pedido, só com esta peça (PLANO.md, seção 3.6)
    function textoProduto() {
      var e = m.estado;
      var corMsg = e.cor || (form ? form.dataset.corFixa : '');
      var linhas = ['Olá! Quero um orçamento.', '', '• ' + (e.qtd > 0 ? e.qtd + ' × ' : '') + m.dataset.produto];
      if (corMsg) linhas.push('  Cor: ' + corMsg);
      if (e.marca.length) linhas.push('  Marca: ' + e.marca.join(', ').toLowerCase());
      var tamanhosMsg = textoTamanhos(e.tam);
      if (tamanhosMsg) linhas.push('  Tamanhos: ' + tamanhosMsg);
      var fim = [];
      if (e.qtd > 0) fim.push('Total: ' + pecas(e.qtd) + '.');
      if (e.marca.length) fim.push('Vou enviar a logo aqui na conversa.');
      return linhas.concat(fim.length ? [''].concat(fim) : []).join('\n');
    }

    function atualizaZap() {
      if (!botaoZap) return;
      var msg;
      if (m.dataset.produto) {
        msg = textoProduto();
      } else {
        var modelo = m.querySelector('.modelos button[aria-pressed="true"]');
        var nome = (modelo ? modelo.dataset.frase : 'uniforme') + ' em ' + (m.dataset.tecido || 'malha');
        msg = 'Olá! Quero um orçamento de ' + nome + (cor ? ', na cor ' + cor : '') +
          (m.dataset.assunto ? ', para o ' + m.dataset.assunto : '') + '.';
      }
      botaoZap.href = zap(msg);
    }

    function mudou() {
      sincroniza();
      atualizaZap();
      m.dispatchEvent(new CustomEvent('mostruario:mudou', { bubbles: true }));
    }

    function pinta(botao) {
      retalhos.forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
      botao.setAttribute('aria-pressed', 'true');
      cor = botao.dataset.cor;
      if (nomeCor) nomeCor.textContent = cor;
      if (svg) {
        var hex = botao.dataset.hex;
        var claro = claridade(hex);
        svg.style.setProperty('--cor', hex);
        svg.style.setProperty('--traco', claro < 0.45 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)');
        svg.style.setProperty('--laco', claro > 0.8 ? '#e6007e' : '#fff');
      }
      mudou();
    }

    function paraGiro() { if (giro) { clearInterval(giro); giro = null; } }

    retalhos.forEach(function (b) {
      b.addEventListener('click', function () { paraGiro(); pinta(b); });
    });

    m.querySelectorAll('.modelos button').forEach(function (b) {
      b.addEventListener('click', function () {
        paraGiro();
        m.querySelectorAll('.modelos button').forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        svg.querySelectorAll('.peca').forEach(function (g) { g.classList.toggle('ativa', g.dataset.peca === b.dataset.peca); });
        if (rotulo) rotulo.textContent = b.textContent;
        mudou();
      });
    });

    // onde vai a marca: botões que ligam e desligam, pode ser mais de um
    posicoes.forEach(function (b) {
      b.addEventListener('click', function () {
        b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        mudou();
      });
    });

    // tamanhos: cada campo soma na quantidade; ao sair do campo, só números inteiros e positivos ficam na tela
    tamanhos.forEach(function (c) {
      c.addEventListener('input', mudou);
      c.addEventListener('change', function () {
        var n = inteiro(c.value);
        c.value = n ? n : '';
        mudou();
      });
    });
    if (campoQtd) campoQtd.addEventListener('input', mudou);

    // logo da empresa do visitante: lida só no navegador, nada é enviado
    var arquivo = m.querySelector('[data-logo]');
    if (arquivo && svg) {
      arquivo.addEventListener('change', function () {
        var f = arquivo.files && arquivo.files[0];
        if (!f || f.type.indexOf('image/') !== 0) return;
        var leitor = new FileReader();
        leitor.onload = function () {
          svg.querySelectorAll('.p-logo').forEach(function (i) { i.setAttribute('href', leitor.result); });
          svg.classList.add('com-logo');
        };
        leitor.readAsDataURL(f);
        paraGiro();
      });
    }

    // na capa, a peça passa por algumas cores sozinha até a pessoa tocar em algo
    var semMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (m.hasAttribute('data-gira') && retalhos.length && !semMovimento) {
      var ordem = ['Vermelho', 'Verde Bandeira', 'Amarelo Ouro', 'Preto', 'Azul Royal'];
      var passo = 0;
      giro = setInterval(function () {
        var alvo = retalhos.filter(function (r) { return r.dataset.cor === ordem[passo]; })[0];
        if (alvo) pinta(alvo);
        passo += 1;
        if (passo >= ordem.length) paraGiro();
      }, 2600);
    }

    // o navegador pode devolver o que a pessoa já tinha digitado (voltar, recarregar): refaz o estado e o link
    sincroniza();
    if (m.estado.marca.length || Object.keys(m.estado.tam).length) atualizaZap();
  });
})();
// Mapra, visual novo: pedido com várias peças num envio só, guardado no aparelho (PLANO.md, seções 3.5 e 3.6).
// Lê o que o visitante escolheu em el.estado (mostruario.js) e monta a mensagem do WhatsApp. Sem bibliotecas.
(function () {
  'use strict';
  var raiz = document.documentElement;
  var NUMERO = raiz.dataset.zap;
  var MINIMO = parseInt(raiz.dataset.minimo, 10) || 10;

  function zap(msg) { return 'https://wa.me/' + NUMERO + '?text=' + encodeURIComponent(msg); }
  function pecas(n) { return n + (n === 1 ? ' peça' : ' peças'); }
  // regra da Mapra: cada peça do pedido precisa de pelo menos MINIMO unidades
  function faltam(qtd) { return MINIMO - qtd === 1 ? 'falta 1' : 'faltam ' + (MINIMO - qtd); }
  function inteiro(texto) { var n = parseInt(texto, 10); return n > 0 ? n : 0; }

  /* "Tradicional P" 5, "Tradicional M" 10, "Feminina P" 3  ->  "Tradicional P 5, M 10; Feminina P 3" */
  function textoTamanhos(tam) {
    var grupos = [];
    Object.keys(tam).forEach(function (chave) {
      var corte = chave.lastIndexOf(' ');
      var modelagem = chave.slice(0, corte);
      var grupo = grupos.filter(function (g) { return g.nome === modelagem; })[0];
      if (!grupo) { grupo = { nome: modelagem, itens: [] }; grupos.push(grupo); }
      grupo.itens.push(chave.slice(corte + 1) + ' ' + tam[chave]);
    });
    return grupos.map(function (g) { return g.nome + ' ' + g.itens.join(', '); }).join('; ');
  }

  /* ---------- o que fica guardado no aparelho ---------- */
  var CHAVE = 'mapra-pedido';
  var CHAVE_CLIENTE = 'mapra-cliente';
  var memoria = [];
  var memoriaCliente = { nome: '', empresa: '', telefone: '' };

  // aceita só o que tem a forma de um item; pedidos guardados por versões antigas (sem marca nem tamanhos) continuam valendo
  function normaliza(i) {
    if (!i || typeof i.slug !== 'string' || typeof i.nome !== 'string') return null;
    var qtd = inteiro(i.qtd);
    if (!qtd) return null;
    var tam = {};
    if (i.tam && typeof i.tam === 'object') {
      Object.keys(i.tam).forEach(function (k) { var n = inteiro(i.tam[k]); if (n) tam[k] = n; });
    }
    return {
      slug: i.slug,
      nome: i.nome,
      cor: typeof i.cor === 'string' ? i.cor : '',
      qtd: qtd,
      marca: Array.isArray(i.marca) ? i.marca.filter(function (s) { return typeof s === 'string'; }) : [],
      tam: tam,
      artes: Array.isArray(i.artes) ? i.artes.slice(0, 20).map(arte).filter(Boolean) : [],
      tecnica: texto(i.tecnica, 60),
      obs: texto(i.obs, 2000),
      id: texto(i.id, 60),
      ficha: i.ficha === true
    };
  }
  function texto(v, limite) { return typeof v === 'string' ? v.slice(0, limite) : ''; }
  // uma arte posta no personalizador: onde fica, a medida, o nome do arquivo e como foi tratada (fundo, cor)
  function arte(a) {
    if (!a || typeof a.lugar !== 'string' || !a.lugar) return null;
    return { lugar: texto(a.lugar, 60), medida: texto(a.medida, 40), arquivo: texto(a.arquivo, 160), aspecto: texto(a.aspecto, 120) };
  }
  function textoArte(a) {
    var detalhe = [a.medida, a.aspecto].filter(Boolean).join('; ');
    return a.lugar + (a.arquivo ? ': ' + a.arquivo : '') + (detalhe ? ' (' + detalhe + ')' : '');
  }

  function le() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE));
      if (Array.isArray(v)) return v.map(normaliza).filter(Boolean);
    } catch (e) { /* sem armazenamento: vale o que está na memória desta página */ }
    return memoria;
  }
  function grava(itens) {
    memoria = itens;
    try { localStorage.setItem(CHAVE, JSON.stringify(itens)); } catch (e) { /* idem */ }
    apagaFichasFora(itens.map(function (i) { return i.id; }));
    poeEtapa(1);
    desenha();
  }

  /* ---------- o envio em dois toques, um botão por vez: 1) o texto do pedido; 2) as imagens (só quando há ficha) ---------- */
  var CHAVE_ENVIO = 'mapra-envio';
  var etapaNaMemoria = 1;
  function etapa() {
    try { return sessionStorage.getItem(CHAVE_ENVIO) === '2' ? 2 : 1; } catch (e) { return etapaNaMemoria; }
  }
  function poeEtapa(n) {
    etapaNaMemoria = n;
    try { if (n === 2) sessionStorage.setItem(CHAVE_ENVIO, '2'); else sessionStorage.removeItem(CHAVE_ENVIO); } catch (e) { /* vale a memória */ }
    desenhaEtapa();
  }
  function temFichas() { return le().some(function (i) { return i.id && fichas[i.id]; }); }
  function desenhaEtapa() {
    if (!janela) return;
    var tem = temFichas();
    var dois = tem && etapa() === 2;
    janela.querySelector('[data-envia]').hidden = dois;
    janela.querySelector('[data-dica-fichas]').hidden = !tem || dois;
    janela.querySelector('[data-passo2]').hidden = !dois;
  }

  /* ---------- ficha do pedido: uma imagem com o cliente e todas as peças (o mesmo do texto, para ir junto das fichas) ---------- */
  function desenhaCapa(itens, cli) {
    try {
      var L = 1200, M = 44, util = L - M * 2;
      var tela = document.createElement('canvas'); tela.width = L; tela.height = 7000;
      var c = tela.getContext('2d');
      var titulo = function (px) { return '800 ' + px + 'px "Big Shoulders Display", "Arial Narrow", Arial, sans-serif'; };
      var corpo = function (px, peso) { return (peso || 500) + ' ' + px + 'px "Instrument Sans", Arial, sans-serif'; };
      var quebra = function (texto, largura) {
        var linhas = [];
        String(texto).split('\n').forEach(function (paragrafo) {
          var atual = '';
          paragrafo.split(/\s+/).filter(Boolean).forEach(function (palavra) {
            var tentativa = atual ? atual + ' ' + palavra : palavra;
            if (atual && c.measureText(tentativa).width > largura) { linhas.push(atual); atual = palavra; } else atual = tentativa;
          });
          linhas.push(atual);
        });
        return linhas;
      };
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, L, tela.height);
      c.fillStyle = '#0c0c0d'; c.fillRect(0, 0, L, 132);
      c.fillStyle = '#ffe600'; c.font = corpo(21, 700); c.fillText('MAPRA UNIFORMES', M, 48);
      c.fillStyle = '#ffffff'; c.font = titulo(58); c.fillText('PEDIDO', M, 106);
      c.textAlign = 'right'; c.font = corpo(21); c.fillStyle = 'rgba(255,255,255,.82)';
      c.fillText(new Date().toLocaleDateString('pt-BR'), L - M, 48);
      c.fillText('Feito no site', L - M, 80);
      c.textAlign = 'left';
      var y = 132 + 54;
      // quem pede
      [['Empresa', cli.empresa], ['Nome', cli.nome], ['Telefone', cli.telefone]].forEach(function (par) {
        if (!par[1]) return;
        c.fillStyle = '#4a4d51'; c.font = corpo(22, 600); c.fillText(par[0].toUpperCase(), M, y);
        c.fillStyle = '#17181a'; c.font = corpo(30, 700); c.fillText(par[1], M + 170, y + 2);
        y += 46;
      });
      y += 18;
      var total = 0;
      itens.forEach(function (item, indice) {
        total += item.qtd;
        c.fillStyle = '#d9dbd6'; c.fillRect(M, y - 26, util, 2); y += 22;
        // número da peça e o nome
        c.fillStyle = '#ffe600'; c.beginPath(); c.arc(M + 24, y - 12, 24, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#17181a'; c.font = corpo(26, 700); c.textAlign = 'center'; c.fillText(String(indice + 1), M + 24, y - 3); c.textAlign = 'left';
        c.font = titulo(40);
        quebra((item.qtd + ' × ' + item.nome).toUpperCase(), util - 66).forEach(function (linha) { c.fillText(linha, M + 66, y); y += 44; });
        y += 4;
        c.font = corpo(26, 600);
        var detalhes = [item.cor ? 'Cor: ' + item.cor : 'Cor a definir'];
        if (item.marca.length) detalhes.push('Marca: ' + item.marca.join(', ').toLowerCase());
        item.artes.forEach(function (a) { detalhes.push('Arte: ' + textoArte(a)); });
        if (item.tecnica) detalhes.push('Aplicação: ' + item.tecnica);
        if (item.obs) detalhes.push('Aviso: ' + item.obs);
        detalhes.forEach(function (d) { quebra(d, util - 66).forEach(function (linha) { c.fillText(linha, M + 66, y); y += 36; }); });
        y += 10;
        // tamanhos: um quadrinho por tamanho, com o tamanho em cima e a quantidade embaixo
        var grupos = [];
        Object.keys(item.tam).forEach(function (chave) {
          var corte = chave.lastIndexOf(' '), nome = chave.slice(0, corte);
          var grupo = grupos.filter(function (g) { return g.nome === nome; })[0];
          if (!grupo) { grupo = { nome: nome, itens: [] }; grupos.push(grupo); }
          grupo.itens.push([chave.slice(corte + 1), item.tam[chave]]);
        });
        grupos.forEach(function (grupo) {
          c.fillStyle = '#4a4d51'; c.font = corpo(22, 600); c.fillText(grupo.nome, M + 66, y + 4); y += 18;
          var lw = 96, lh = 90, vao = 9, x = M + 66;
          grupo.itens.forEach(function (par) {
            if (x + lw > L - M) { x = M + 66; y += lh + vao; }
            c.fillStyle = '#eceee9'; c.fillRect(x, y, lw, 36);
            c.fillStyle = '#ffffff'; c.fillRect(x, y + 36, lw, lh - 36);
            c.strokeStyle = '#17181a'; c.lineWidth = 2; c.strokeRect(x, y, lw, lh);
            c.beginPath(); c.moveTo(x, y + 36); c.lineTo(x + lw, y + 36); c.stroke();
            c.textAlign = 'center'; c.fillStyle = '#17181a';
            c.font = corpo(22, 700); c.fillText(String(par[0]), x + lw / 2, y + 26);
            c.font = titulo(42); c.fillText(String(par[1]), x + lw / 2, y + 78);
            c.textAlign = 'left';
            x += lw + vao;
          });
          y += lh + 26;
        });
        y += 26;
      });
      c.fillStyle = '#17181a'; c.fillRect(M, y - 20, util, 3); y += 34;
      c.font = titulo(46); c.fillText('TOTAL: ' + pecas(total).toUpperCase(), M, y); y += 44;
      c.fillStyle = '#4a4d51'; c.font = corpo(21);
      quebra('Pedido montado pelo cliente no site. A Mapra confere a arte, a cor, os tamanhos e o lugar de cada aplicação antes de produzir.', util).forEach(function (linha) { c.fillText(linha, M, y); y += 30; });
      y += 22;
      var pronta = document.createElement('canvas'); pronta.width = L; pronta.height = Math.ceil(y);
      pronta.getContext('2d').drawImage(tela, 0, 0);
      // direto para arquivo, sem esperar: o compartilhar do celular precisa ser chamado no mesmo toque
      var dados = atob(pronta.toDataURL('image/jpeg', 0.9).split(',')[1]);
      var bytes = new Uint8Array(dados.length);
      for (var n = 0; n < dados.length; n++) bytes[n] = dados.charCodeAt(n);
      return new File([bytes], 'pedido-mapra.jpg', { type: 'image/jpeg' });
    } catch (e) { return null; }
  }

  /* ---------- fichas das peças personalizadas: imagem com as vistas e as medidas, guardada pelo personalizador (personalizador/ficha.mjs) ---------- */
  var BANCO = 'mapra-pedido', LOJA = 'fichas';
  var fichas = {};   // número da peça -> { ficha: imagem, logos: [{ nome, blob }], url: endereço da imagem para mostrar }
  function banco(modo, faz) {
    return new Promise(function (ok, erro) {
      if (!window.indexedDB) { erro(new Error('sem banco')); return; }
      var pedido = indexedDB.open(BANCO, 1);
      pedido.onupgradeneeded = function () { if (!pedido.result.objectStoreNames.contains(LOJA)) pedido.result.createObjectStore(LOJA, { keyPath: 'id' }); };
      pedido.onerror = function () { erro(pedido.error); };
      pedido.onsuccess = function () {
        var db = pedido.result, troca = db.transaction(LOJA, modo), saida = faz(troca.objectStore(LOJA));
        troca.oncomplete = function () { db.close(); ok(saida && saida.result); };
        troca.onerror = troca.onabort = function () { db.close(); erro(troca.error); };
      };
    });
  }
  function apagaFichasFora(ids) {
    Object.keys(fichas).forEach(function (id) {
      if (ids.indexOf(id) < 0) { URL.revokeObjectURL(fichas[id].url); delete fichas[id]; }
    });
    banco('readonly', function (loja) { return loja.getAllKeys(); }).then(function (chaves) {
      var sobra = (chaves || []).filter(function (id) { return ids.indexOf(id) < 0; });
      if (sobra.length) return banco('readwrite', function (loja) { sobra.forEach(function (id) { loja.delete(id); }); });
    }).catch(function () { /* sem banco neste aparelho: não há ficha para apagar */ });
  }
  // lê do aparelho as fichas das peças do pedido e mostra a miniatura em cada uma
  function carregaFichas() {
    if (!janela) return;
    var itens = le().filter(function (i) { return i.ficha && i.id; });
    if (!itens.length || itens.every(function (i) { return fichas[i.id]; })) { mostraFichas(); return; }
    banco('readonly', function (loja) { return loja.getAll(); }).then(function (registros) {
      (registros || []).forEach(function (r) {
        if (!fichas[r.id] && r.ficha) fichas[r.id] = { ficha: r.ficha, logos: r.logos || [], url: URL.createObjectURL(r.ficha) };
      });
      mostraFichas();
    }).catch(mostraFichas);
  }
  function mostraFichas() {
    var tem = false;
    janela.querySelectorAll('[data-ficha-de]').forEach(function (a) {
      var f = fichas[a.dataset.fichaDe];
      a.hidden = !f;
      if (!f) return;
      tem = true;
      a.href = f.url;
      if (!a.firstChild) {
        var img = document.createElement('img');
        img.alt = 'Ficha da peça, com as artes e as medidas';
        img.src = f.url;
        a.appendChild(img);
        a.appendChild(linha('', 'Ficha · toque para ampliar'));
      }
    });
    desenhaEtapa();
    // quem volta do WhatsApp com o passo 2 por fazer encontra a janela aberta nele
    if (tem && etapa() === 2 && !janela.open && !abriuSozinha) {
      abriuSozinha = true;
      if (janela.showModal) janela.showModal(); else janela.setAttribute('open', '');
    }
  }
  var abriuSozinha = false;
  // os arquivos que seguem na conversa: a ficha de cada peça e as logos originais, na ordem do pedido
  function arquivosDoPedido() {
    var arquivos = [];
    var capa = desenhaCapa(le(), cliente());
    if (capa) arquivos.push(capa);
    le().forEach(function (item, indice) {
      var f = item.id && fichas[item.id];
      if (!f) return;
      var n = indice + 1;
      arquivos.push(new File([f.ficha], 'ficha-' + n + '-' + item.slug + '.jpg', { type: 'image/jpeg' }));
      f.logos.forEach(function (logo) { arquivos.push(new File([logo.blob], 'peca-' + n + '-logo-' + logo.nome, { type: logo.blob.type || 'image/png' })); });
    });
    return arquivos;
  }
  function baixa(arquivos) {
    arquivos.forEach(function (arquivo, indice) {
      setTimeout(function () {
        var a = document.createElement('a'), url = URL.createObjectURL(arquivo);
        a.href = url; a.download = arquivo.name;
        janela.appendChild(a); a.click(); janela.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }, indice * 350);
    });
  }

  function leCliente() {
    try {
      var v = JSON.parse(localStorage.getItem(CHAVE_CLIENTE));
      if (v && typeof v === 'object') return { nome: String(v.nome || ''), empresa: String(v.empresa || ''), telefone: String(v.telefone || '') };
    } catch (e) { /* idem */ }
    return memoriaCliente;
  }
  function gravaCliente(c) {
    memoriaCliente = c;
    try { localStorage.setItem(CHAVE_CLIENTE, JSON.stringify(c)); } catch (e) { /* idem */ }
  }

  // dois itens só se somam se forem a mesma peça, na mesma cor, com a mesma marca e os mesmos tamanhos
  function mesmo(a, b) {
    if (a.artes.length || b.artes.length || a.obs || b.obs || a.tecnica !== b.tecnica) return false;
    if (a.slug !== b.slug || a.cor !== b.cor) return false;
    if (a.marca.length !== b.marca.length) return false;
    for (var x = 0; x < a.marca.length; x++) { if (a.marca[x] !== b.marca[x]) return false; }
    var ka = Object.keys(a.tam);
    if (ka.length !== Object.keys(b.tam).length) return false;
    return ka.every(function (k) { return a.tam[k] === b.tam[k]; });
  }

  /* ---------- a mensagem do WhatsApp ---------- */
  function mensagem(itens, cliente) {
    var linhas = ['Olá! Quero um orçamento.'];
    if (cliente.empresa) linhas.push('Empresa: ' + cliente.empresa);
    if (cliente.nome) linhas.push('Nome: ' + cliente.nome);
    if (cliente.telefone) linhas.push('Telefone: ' + cliente.telefone);
    linhas.push('');
    var total = 0;
    var comMarca = false;
    itens.forEach(function (i) {
      total += i.qtd;
      linhas.push('• ' + i.qtd + ' × ' + i.nome);
      if (i.cor) linhas.push('  Cor: ' + i.cor);
      if (i.marca.length) { linhas.push('  Marca: ' + i.marca.join(', ').toLowerCase()); comMarca = true; }
      if (i.artes.length) {
        linhas.push('  Artes:');
        i.artes.forEach(function (a) { linhas.push('  - ' + textoArte(a)); });
        comMarca = true;
      }
      var t = textoTamanhos(i.tam);
      if (t) linhas.push('  Tamanhos: ' + t);
      if (i.tecnica) linhas.push('  Aplicação: ' + i.tecnica);
      if (i.obs) linhas.push('  Aviso: ' + i.obs);
    });
    linhas.push('', 'Total: ' + pecas(total) + '.');
    if (itens.some(function (i) { return i.ficha; })) linhas.push('Vou enviar aqui na conversa a ficha de cada peça (imagem com as medidas) e as logos.');
    else if (comMarca) linhas.push('Vou enviar as logos aqui na conversa.');
    return linhas.join('\n');
  }

  /* ---------- a janela "Meu pedido" ---------- */
  var janela = document.getElementById('pedido');
  var barra = document.querySelector('[data-barra]');
  var campoNome = janela && janela.querySelector('[data-campo-nome]');
  var campoEmpresa = janela && janela.querySelector('[data-campo-empresa]');
  var campoTelefone = janela && janela.querySelector('[data-campo-telefone]');
  var confirma = janela && janela.querySelector('[data-confirma]');
  var avisoCopia = janela && janela.querySelector('[data-copiado]');
  var relogio = null;

  function cliente() {
    if (!campoNome) return leCliente();
    return { nome: campoNome.value.trim(), empresa: campoEmpresa.value.trim(), telefone: campoTelefone.value.trim() };
  }

  function atualizaLink() {
    if (!janela) return;
    var itens = le();
    if (itens.length) janela.querySelector('[data-envia]').href = zap(mensagem(itens, cliente()));
  }

  function linha(classe, texto) {
    var s = document.createElement('span');
    s.className = classe;
    s.textContent = texto;
    return s;
  }

  function desenha() {
    var itens = le();
    var total = itens.reduce(function (s, i) { return s + i.qtd; }, 0);
    document.querySelectorAll('[data-conta]').forEach(function (c) { c.textContent = total; });
    raiz.classList.toggle('tem-pedido', total > 0);
    if (barra) { barra.hidden = total === 0; barra.querySelector('[data-barra-total]').textContent = pecas(total); }
    if (!janela) return;

    var lista = janela.querySelector('[data-lista]');
    lista.textContent = '';
    itens.forEach(function (item, indice) {
      var li = document.createElement('li');
      var n = linha('n', item.nome);
      n.appendChild(linha('c', item.cor ? 'Cor: ' + item.cor : 'Cor a definir'));
      if (item.marca.length) n.appendChild(linha('c', 'Marca: ' + item.marca.join(', ').toLowerCase()));
      item.artes.forEach(function (a) { n.appendChild(linha('c arte', a.lugar + (a.medida ? ' · ' + a.medida : ''))); });
      var t = textoTamanhos(item.tam);
      if (t) n.appendChild(linha('c', 'Tamanhos: ' + t));
      if (item.tecnica) n.appendChild(linha('c', 'Aplicação: ' + item.tecnica));
      if (item.qtd < MINIMO) n.appendChild(linha('c falta', 'Mínimo de ' + MINIMO + ' por peça: ' + faltam(item.qtd) + '.'));
      if (item.ficha && item.id) {
        var ficha = document.createElement('a');
        ficha.className = 'pedido-ficha'; ficha.target = '_blank'; ficha.rel = 'noopener'; ficha.hidden = true;
        ficha.setAttribute('data-ficha-de', item.id);
        n.appendChild(ficha);
      }
      var tira = document.createElement('button');
      tira.type = 'button';
      tira.textContent = 'Tirar';
      tira.setAttribute('aria-label', 'Tirar ' + item.nome + ' do pedido');
      tira.addEventListener('click', function () {
        if (tira.dataset.certeza) { var novo = le(); novo.splice(indice, 1); grava(novo); return; }
        tira.dataset.certeza = '1';
        tira.textContent = 'Tirar mesmo?';
        setTimeout(function () { delete tira.dataset.certeza; tira.textContent = 'Tirar'; }, 4000);
      });
      li.appendChild(linha('q', item.qtd));
      li.appendChild(n);
      li.appendChild(tira);
      lista.appendChild(li);
    });

    var vazio = total === 0;
    janela.querySelector('[data-vazio]').hidden = !vazio;
    janela.querySelector('[data-total-linha]').hidden = vazio;
    janela.querySelector('[data-cliente]').hidden = vazio;
    janela.querySelector('[data-acoes]').hidden = vazio;
    janela.querySelector('[data-total]').textContent = pecas(total);
    var aviso = janela.querySelector('[data-minimo]');
    var abaixo = itens.filter(function (i) { return i.qtd < MINIMO; });
    aviso.hidden = vazio || !abaixo.length;
    if (!aviso.hidden) aviso.textContent = 'Cada peça do pedido precisa de pelo menos ' + MINIMO + ' unidades. Confira ' + (abaixo.length === 1 ? 'a peça marcada' : 'as peças marcadas') + ' acima.';
    if (avisoCopia) avisoCopia.textContent = '';
    perguntaEsvaziar(false);
    atualizaLink();
    carregaFichas();
  }

  function perguntaEsvaziar(mostra) {
    if (!confirma) return;
    confirma.hidden = !mostra;
    janela.querySelector('[data-esvazia]').hidden = mostra;
    if (mostra) janela.querySelector('[data-esvazia-nao]').focus();
  }

  // Regra da Mapra: o pedido só sai com nome, empresa e telefone (com DDD). Devolve true quando está tudo preenchido;
  // se faltar algo, marca os campos, diz o que falta e leva a pessoa ao primeiro deles.
  function dadosCompletos(avisar) {
    if (!campoNome) return true;
    var digitos = campoTelefone.value.replace(/\D/g, '').length;
    var faltas = [];
    if (campoNome.value.trim().length < 2) faltas.push([campoNome, 'o nome']);
    if (campoEmpresa.value.trim().length < 2) faltas.push([campoEmpresa, 'a empresa']);
    if (digitos < 10 || digitos > 13) faltas.push([campoTelefone, 'o telefone com DDD']);
    if (!avisar) return faltas.length === 0;
    [campoNome, campoEmpresa, campoTelefone].forEach(function (campo) {
      var falta = faltas.some(function (f) { return f[0] === campo; });
      if (falta) campo.setAttribute('aria-invalid', 'true'); else campo.removeAttribute('aria-invalid');
    });
    var aviso = janela.querySelector('[data-falta]');
    if (aviso) {
      var nomes = faltas.map(function (f) { return f[1]; });
      var lista = nomes.length > 1 ? nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] : nomes[0];
      aviso.textContent = faltas.length ? 'Para enviar, preencha ' + lista + '.' : '';
      aviso.hidden = faltas.length === 0;
    }
    if (faltas.length) faltas[0][0].focus();
    return faltas.length === 0;
  }

  function preencheCliente() {
    if (!campoNome) return;
    var c = leCliente();
    campoNome.value = c.nome;
    campoEmpresa.value = c.empresa;
    campoTelefone.value = c.telefone;
  }

  // copiar para a área de transferência; se a API moderna não existir (página sem https) ou for recusada, tenta o jeito antigo
  function copia(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto).catch(function () { return copiaAntiga(texto); });
    }
    return copiaAntiga(texto);
  }
  function copiaAntiga(texto) {
    return new Promise(function (ok, erro) {
      var campo = document.createElement('textarea');
      campo.value = texto;
      campo.setAttribute('readonly', '');
      campo.style.position = 'fixed';
      campo.style.opacity = '0';
      janela.appendChild(campo);   // dentro da janela, porque o resto da página fica bloqueado enquanto ela está aberta
      campo.select();
      var certo = false;
      try { certo = document.execCommand('copy'); } catch (e) { /* cai no erro abaixo */ }
      janela.removeChild(campo);
      if (certo) ok(); else erro(new Error('copy'));
    });
  }

  function avisaCopia(texto) {
    avisoCopia.textContent = texto;
    clearTimeout(relogio);
    relogio = setTimeout(function () { avisoCopia.textContent = ''; }, 5000);
  }

  document.querySelectorAll('[data-abre-pedido]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!janela) return;
      if (janela.showModal) janela.showModal(); else janela.setAttribute('open', '');
    });
  });

  if (janela) {
    janela.querySelector('[data-fecha-pedido]').addEventListener('click', function () {
      if (janela.close) janela.close(); else janela.removeAttribute('open');
    });
    janela.addEventListener('click', function (ev) { if (ev.target === janela && janela.close) janela.close(); });
    var botaoEsvazia = janela.querySelector('[data-esvazia]');
    botaoEsvazia.addEventListener('click', function () { perguntaEsvaziar(true); });
    janela.querySelector('[data-esvazia-nao]').addEventListener('click', function () { perguntaEsvaziar(false); });
    janela.querySelector('[data-esvazia-sim]').addEventListener('click', function () { grava([]); });
    janela.querySelectorAll('[data-continua]').forEach(function (b) {
      b.addEventListener('click', function () { if (janela.close) janela.close(); else janela.removeAttribute('open'); });
    });

    [campoNome, campoEmpresa, campoTelefone].forEach(function (campo) {
      campo.addEventListener('input', function () {
        gravaCliente(cliente()); atualizaLink();
        if (campo.hasAttribute('aria-invalid') || !janela.querySelector('[data-falta]').hidden) {
          campo.removeAttribute('aria-invalid');
          if (dadosCompletos(false)) janela.querySelector('[data-falta]').hidden = true;
        }
      });
    });

    var botaoEnvia = janela.querySelector('[data-envia]');
    // no computador a conversa abre em outra aba, para o site continuar aqui com o passo 2
    if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) { botaoEnvia.target = '_blank'; }
    botaoEnvia.addEventListener('click', function (ev) {
      if (!dadosCompletos(true)) { ev.preventDefault(); return; }
      if (temFichas()) setTimeout(function () { poeEtapa(2); }, 400);
    });
    janela.querySelector('[data-reenviar]').addEventListener('click', function () { poeEtapa(1); });

    janela.querySelector('[data-fichas]').addEventListener('click', function () {
      var arquivos = arquivosDoPedido();
      var aviso = janela.querySelector('[data-fichas-aviso]');
      if (!arquivos.length) return;
      var baixaTudo = function () {
        baixa(arquivos);
        aviso.textContent = 'As imagens foram salvas neste aparelho. Anexe na conversa do WhatsApp com a Mapra.';
      };
      if (navigator.canShare && navigator.canShare({ files: arquivos })) {
        navigator.share({ files: arquivos, title: 'Pedido Mapra', text: 'Fichas e logos do meu pedido.' }).then(
          function () { aviso.textContent = 'Pronto: texto e imagens enviados. A Mapra responde na conversa.'; },
          function (erro) { if (!erro || erro.name !== 'AbortError') baixaTudo(); }
        );
        return;
      }
      baixaTudo();
    });

    janela.querySelector('[data-copia]').addEventListener('click', function () {
      var itens = le();
      if (!itens.length) return;
      if (!dadosCompletos(true)) return;
      var texto = mensagem(itens, cliente());
      copia(texto).then(
        function () { avisaCopia('Pedido copiado. Agora é só colar na conversa do WhatsApp.'); },
        function () { avisaCopia('Não foi possível copiar neste aparelho. Use o botão de enviar no WhatsApp.'); }
      );
    });
  }

  /* ---------- "Adicionar ao pedido" nas páginas de produto ---------- */
  document.querySelectorAll('[data-add-pedido]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var mostruario = form.closest('[data-mostruario]');
      var estado = (mostruario && mostruario.estado) || {};
      var tam = {};
      Object.keys(estado.tam || {}).forEach(function (k) { tam[k] = estado.tam[k]; });
      // passa pela mesma forma dos itens guardados (com artes, técnica e aviso vazios), para poder comparar com eles
      var item = normaliza({
        slug: form.dataset.slug,
        nome: form.dataset.nome,
        cor: form.dataset.corFixa || estado.cor || '',
        qtd: Math.max(1, Math.min(9999, estado.qtd || inteiro(form.elements.qtd.value) || MINIMO)),
        marca: (estado.marca || []).slice(),
        tam: tam
      });
      var aviso = form.querySelector('[data-add-aviso]');
      if (!aviso) {
        aviso = document.createElement('p');
        aviso.className = 'add-aviso'; aviso.setAttribute('role', 'alert'); aviso.setAttribute('data-add-aviso', ''); aviso.hidden = true;
        form.appendChild(aviso);
      }
      if (item.qtd < MINIMO) {
        aviso.textContent = 'O mínimo é de ' + MINIMO + ' peças de cada modelo. Você escolheu ' + item.qtd + ': ' + faltam(item.qtd) + '.';
        aviso.hidden = false;
        return;
      }
      aviso.hidden = true;
      var itens = le();
      var igual = itens.filter(function (i) { return mesmo(i, item); })[0];
      if (igual) {
        igual.qtd += item.qtd;
        Object.keys(item.tam).forEach(function (k) { igual.tam[k] += item.tam[k]; });
      } else {
        itens.push(item);
      }
      grava(itens);
      var botao = form.querySelector('button[type="submit"]');
      var texto = botao.textContent;
      botao.textContent = 'Adicionado ao pedido';
      setTimeout(function () { botao.textContent = texto; }, 2200);
    });
  });

  // o pedido pode mudar em outra aba aberta do mesmo site
  window.addEventListener('storage', function (ev) {
    if (ev.key === CHAVE) desenha();
    if (ev.key === CHAVE_CLIENTE) { preencheCliente(); atualizaLink(); }
  });

  preencheCliente();
  desenha();

  // quem termina uma peça no personalizador chega aqui com #pedido no endereço: a janela já abre com tudo
  if (janela && location.hash === '#pedido') {
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    if (janela.showModal) janela.showModal(); else janela.setAttribute('open', '');
  }
})();
// Mapra, visual novo: filtro do catálogo por tipo de peça, também pelo endereço (#polos).
(function () {
  'use strict';
  /* ---------- catálogo: filtro por tipo de peça, também pelo endereço (#polos) ---------- */
  var filtros = Array.prototype.slice.call(document.querySelectorAll('.filtros button'));
  function filtra(linha, rolar) {
    var botao = filtros.filter(function (f) { return f.dataset.linha === linha; })[0];
    if (!botao) return;
    filtros.forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
    botao.setAttribute('aria-pressed', 'true');
    var cartoes = document.querySelectorAll('.grade .cartao'), visiveis = 0;
    cartoes.forEach(function (c) { c.hidden = !!linha && c.dataset.linha !== linha; if (!c.hidden) visiveis++; });
    // diz quantas peças apareceram e, no celular, leva a pessoa até elas (os filtros ocupam a tela e o resultado ficava escondido)
    var conta = document.querySelector('[data-filtro-conta]');
    if (conta) {
      conta.textContent = linha ? 'Mostrando ' + visiveis + (visiveis === 1 ? ' peça' : ' peças') + ' de ' + cartoes.length + ': ' + botao.textContent.trim() : 'Mostrando as ' + cartoes.length + ' peças';
      if (rolar && conta.getBoundingClientRect().top > window.innerHeight * 0.55) resultado.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
    if (volta) volta.hidden = !linha;
  }
  var resultado = document.querySelector('[data-filtro-linha]');
  var volta = document.querySelector('[data-filtro-volta]');
  // "Trocar o tipo": sobe até os botões de tipo de peça
  if (volta) volta.addEventListener('click', function () { document.querySelector('.filtros').scrollIntoView({ behavior: 'auto', block: 'start' }); });
  filtros.forEach(function (f) {
    f.addEventListener('click', function () {
      filtra(f.dataset.linha, true);
      if (history.replaceState) history.replaceState(null, '', f.dataset.linha ? '#' + f.dataset.linha : location.pathname);
    });
  });
  // Quem chega já com o tipo escolhido (vem da capa, por "O que a Mapra faz") cai direto nas fotos desse tipo,
  // sem passar de novo pelos botões que acabou de usar. Quem chega pelo "Catálogo" vê a página do começo.
  if (filtros.length && location.hash) {
    var pedida = location.hash.slice(1);
    filtra(pedida);
    if (resultado && pedida && filtros.some(function (f) { return f.dataset.linha === pedida; })) {
      var mexeu = false;
      ['touchstart', 'wheel', 'keydown'].forEach(function (tipo) { window.addEventListener(tipo, function () { mexeu = true; }, { once: true, passive: true }); });
      var leva = function () { if (!mexeu) resultado.scrollIntoView({ behavior: 'auto', block: 'start' }); };
      leva();
      // de novo quando a página assenta: as fotos de cima terminam de carregar e o cabeçalho fixo encolhe ao rolar
      window.addEventListener('load', leva);
      [250, 700].forEach(function (ms) { setTimeout(leva, ms); });
    }
  }
})();
// Mapra, visual novo: galeria de fotos da página de produto.
(function () {
  'use strict';
  /* ---------- galeria do produto ---------- */
  var principal = document.querySelector('.galeria .principal img');
  document.querySelectorAll('.miniaturas button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!principal) return;
      principal.srcset = b.dataset.srcset;
      principal.src = b.dataset.src;
      document.querySelectorAll('.miniaturas button').forEach(function (o) { o.removeAttribute('aria-current'); });
      b.setAttribute('aria-current', 'true');
    });
  });
})();
// Mapra, visual novo: movimento do topo da capa. A camiseta que troca de cor sozinha.
// Quem pede menos movimento no aparelho (prefers-reduced-motion; no Windows, "efeitos de animação" desligados)
// vê a camiseta trocar de cor sem transição. O botão ao lado dela pausa a troca. Sem bibliotecas.
(function () {
  'use strict';
  var calmo = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var parado = false; // a pessoa apertou "Pausar movimento"
  // para conferir os movimentos num computador que está com as animações desligadas: abra a página com ?movimento=1
  if (/[?&]movimento=1/.test(location.search)) calmo = false;

  // só anima o que está na tela
  function quandoVisivel(el, avisa) {
    if (!('IntersectionObserver' in window)) { avisa(true); return; }
    new IntersectionObserver(function (entradas) { avisa(entradas[0].isIntersecting); }).observe(el);
  }

  // botão de pausa: para a troca de cor da camiseta; apertar de novo retoma
  var botaoPausa = document.querySelector('[data-pausa]');
  function marcaPausa(sim) {
    parado = sim;
    if (!botaoPausa) return;
    botaoPausa.setAttribute('aria-pressed', String(parado));
    botaoPausa.setAttribute('aria-label', parado ? 'Continuar a troca de cor da camiseta' : 'Pausar a troca de cor da camiseta');
    botaoPausa.querySelector('[data-pausa-sinal]').textContent = parado ? '>' : 'II';
  }
  if (botaoPausa) botaoPausa.addEventListener('click', function () { marcaPausa(!parado); });

  /* ---------- camiseta viva: a foto da camiseta neutra é tingida, uma cor da cartela de cada vez ---------- */
  var vivo = document.querySelector('[data-vivo]');
  if (vivo) {
    var cores = [];
    try { cores = JSON.parse(vivo.dataset.vivo); } catch (e) { /* sem cores: fica na primeira */ }
    var filtro = vivo.querySelector('feColorMatrix');
    var nome = vivo.querySelector('[data-vivo-nome]');
    var ponto = vivo.querySelector('[data-vivo-ponto]');
    var pontos = [].slice.call(vivo.querySelectorAll('[data-vivo-cor]'));
    var links = [].slice.call(vivo.querySelectorAll('[data-vivo-link]'));
    var atual = cores.length ? cores[0].m.slice() : [];
    var indice = 0;
    var naTela = false;
    var corrida = 0; // só a última troca pedida continua pintando

    function vai(k) {
      var de = atual.slice(), para = cores[k].m, inicio = 0, minha = ++corrida;
      nome.textContent = cores[k].n;
      if (ponto) ponto.style.background = cores[k].h;
      vivo.classList.toggle('clara', !!cores[k].c);
      pontos.forEach(function (botao, n) { botao.setAttribute('aria-pressed', String(n === k)); });
      // o personalizador abre já na cor que está na tela
      links.forEach(function (link) { link.setAttribute('href', link.getAttribute('href').split('?')[0] + '?cor=' + encodeURIComponent(cores[k].n)); });
      if (calmo) { atual = para.slice(); filtro.setAttribute('values', atual.join(' ')); return; } // troca de cor não é deslocamento: fica, só sem a transição
      function passo(agora) {
        if (minha !== corrida) return;
        if (!inicio) inicio = agora;
        var p = Math.min(1, (agora - inicio) / 650);
        var suave = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        atual = de.map(function (v, j) { return v + (para[j] - v) * suave; });
        filtro.setAttribute('values', atual.join(' '));
        if (p < 1) requestAnimationFrame(passo);
      }
      requestAnimationFrame(passo);
    }

    if (cores.length > 1 && filtro) {
      quandoVisivel(vivo, function (sim) { naTela = sim; });
      setInterval(function () {
        if (!naTela || document.hidden || parado) return;
        indice = (indice + 1) % cores.length;
        vai(indice);
      }, calmo ? 3600 : 2600);
      // tocar numa cor: a camiseta vai para ela e a troca sozinha para (a pessoa assumiu o controle)
      pontos.forEach(function (botao, k) {
        botao.addEventListener('click', function () { indice = k; vai(k); marcaPausa(true); });
      });
    }
  }
})();
