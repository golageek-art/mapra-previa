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
      obs: texto(i.obs, 2000)
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
    desenha();
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
    if (comMarca) linhas.push('Vou enviar as logos aqui na conversa.');
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

    janela.querySelector('[data-envia]').addEventListener('click', function (ev) {
      if (!dadosCompletos(true)) ev.preventDefault();
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
      if (rolar && conta.getBoundingClientRect().top > window.innerHeight * 0.55) conta.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }
  filtros.forEach(function (f) {
    f.addEventListener('click', function () {
      filtra(f.dataset.linha, true);
      if (history.replaceState) history.replaceState(null, '', f.dataset.linha ? '#' + f.dataset.linha : location.pathname);
    });
  });
  if (filtros.length && location.hash) filtra(location.hash.slice(1));
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

  /* ---------- camiseta viva: a foto da camiseta neutra é tingida, uma cor da cartela de cada vez ---------- */
  var vivo = document.querySelector('[data-vivo]');
  if (vivo) {
    var cores = [];
    try { cores = JSON.parse(vivo.dataset.vivo); } catch (e) { /* sem cores: fica na primeira */ }
    var filtro = vivo.querySelector('feColorMatrix');
    var nome = vivo.querySelector('[data-vivo-nome]');
    var ponto = vivo.querySelector('[data-vivo-ponto]');
    var atual = cores.length ? cores[0].m.slice() : [];
    var indice = 0;
    var naTela = false;

    function vai(k) {
      var de = atual.slice(), para = cores[k].m, inicio = 0;
      nome.textContent = cores[k].n;
      ponto.style.background = cores[k].h;
      vivo.classList.toggle('clara', !!cores[k].c);
      if (calmo) { atual = para.slice(); filtro.setAttribute('values', atual.join(' ')); return; } // troca de cor não é deslocamento: fica, só sem a transição
      function passo(agora) {
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
    }
  }

  // botão de pausa: para a troca de cor da camiseta; apertar de novo retoma
  var botaoPausa = document.querySelector('[data-pausa]');
  if (botaoPausa) {
    botaoPausa.addEventListener('click', function () {
      parado = !parado;
      botaoPausa.setAttribute('aria-pressed', String(parado));
      botaoPausa.setAttribute('aria-label', parado ? 'Continuar a troca de cor da camiseta' : 'Pausar a troca de cor da camiseta');
      botaoPausa.querySelector('[data-pausa-sinal]').textContent = parado ? '>' : 'II';
    });
  }
})();
