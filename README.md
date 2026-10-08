# MIXMIND by Piradex — AI Mixing & Mastering Environment

**AI proposes. Engineer decides.**

**MIXMIND by Piradex** é um ambiente de mistura e masterização inteligente baseado em stems, que corre **inteiramente no browser**. Importa os teus stems, a IA identifica cada instrumento (pelo nome *e* pelo áudio), percebe a estrutura da música, propõe uma direção sonora e executa a mistura e o master — com cada decisão explicada, editável e comparável com loudness match.

O áudio **nunca sai do teu computador**: análise, processamento, render e export acontecem localmente (Web Audio + AudioWorklets + DSP em JavaScript e WebAssembly). O único envio é opcional e explícito: o portal de clientes (ver “Backend para clientes”).

---

## O que faz

| Área | Funcionalidades |
|---|---|
| **Importação** | WAV, AIFF, FLAC, MP3 (ficheiros ou pasta inteira, arrastar e largar). Deteção de pares L/R, mono falso, sample rate diferente, silêncio, clipping no original. |
| **Classificação** | 28 papéis (Lead Vocal, BV, Adlibs, Kick, Snare, Hi-Hat, Shaker, Percussion, Bass, Sub, Guitars, Piano, Rhodes, Synth, Pad, Strings, Brass, FX, Risers…) com % de confiança. Combina nome do ficheiro com espectro, envolvente, transientes, pitch, harmonicidade e estéreo. Avisa quando o nome contradiz o áudio. |
| **Music Intelligence** | BPM, tonalidade (com desambiguação maior/relativa menor), compasso, estrutura (Intro, Verso, Pré, Refrão, Bridge, Refrão final, Outro) e sugestão de género (Kizomba, Semba, Kuduro, Afrobeat, Amapiano, R&B, Pop, Hip-Hop, Trap, Reggaeton, Rock, Jazz, Acoustic, EDM, House, Techno, Gospel). |
| **Direção da mistura** | 9 macros (Warm↔Bright, Soft↔Aggressive, Vintage↔Modern, Dry↔Spacious, Narrow↔Wide, Natural↔Polished, Dynamic↔Loud, Smooth↔Punchy, Clean↔Saturated) com a proposta da IA marcada, presets por género e 10 presets estéticos. |
| **Mistura automática** | Gain staging (−20 LUFS ativos, sem clipping), balanço por fader segundo o género e a hierarquia (Primary/Secondary/Background), panorâmica, HPF, EQ corretiva (lama, boxiness, nasal, aspereza, ressonâncias) e criativa, compressão por instrumento (incl. série na voz), transient shaper, saturação contextual (nunca em todos os canais), de-esser dinâmico, reverbs (plate/room/hall) e delay sincronizado com ducking, mix bus com glue e compressão paralela da bateria. |
| **Anti-masking** | Análise contínua de conflitos de frequência entre stems (por bloco de ~100 ms e por banda de terço de oitava). Corrige com **EQ dinâmico** que só atua quando o elemento protagonista toca, e **sidechain multibanda** kick → baixo (<120 Hz). |
| **Automação** | Vocal rider frase a frase, send de reverb por secção, filtro do pad, delay throws, largura do master (escritos pela IA). Ferramentas de edição: **lápis, linha, formas sincronizadas ao BPM** (seno, triângulo, quadrada, rampas, aleatória) e **borracha** (Alt = apaga também a IA no troço); grelha livre/batida/compasso. Lanes novas por stem: **volume, pan, envio de reverb, envio de delay, passa-baixo, passa-alta, ganho de uma banda de EQ (existente ou nova) e threshold do compressor**; efeitos: **tamanho do reverb** (crossfade entre resposta curta, normal e longa) e **feedback do delay**; no master: **largura e volume/fade**. **Automação aprendida por estilo:** o treino mede como o refrão abre face ao verso (loudness, largura, agudos, voz vs instrumental e — com stems pós-fader — cada instrumento) e a IA escreve essa automação nas sessões desse estilo, descontando o que o arranjo dos teus stems já faz. A edição manual prevalece sobre a IA. |
| **Voz · editor nota a nota** | Para os stems de voz, **antes** da cadeia do mixer: deteção de pitch a cada 5 ms (WebAssembly), notas e sibilantes num piano roll com a escala da música. Ferramentas **Híbrida, Pitch, Mover, Esticar, Dividir, Formantes, Vibrato e Ganho**; **Pitch Centre**, endireitar drift, vibrato original 0–250 % e vibrato acrescentado, **anti-artefactos**, **sibilantes**, **match energy**, **link/glide**, tonalidade e escala (13 escalas, deteção na voz), **harmonia** diatónica como stem novo, repor, A/B e **sugestão da IA** (centra só as notas desafinadas, sem tocar no vibrato nem nos ornamentos). Só as zonas editadas são processadas — o resto da gravação passa bit a bit. |
| **Arranjo** | Pistas por stem com zoom (Ctrl/⌘ + roda, Shift + roda para deslocar). Estrutura editável: arrastar fronteiras (encaixa no compasso; Shift = livre), renomear (duplo clique), dividir no cursor, juntar, remover, repor a deteção da IA — a automação por secção acompanha. **Mute por secção** (botão direito numa pista ou chips “Calar nesta secção”), respeitado na escuta, no master e nos exports. |
| **Análise** | Mapa de frequências **Antes / Depois / Mudança tonal**, por secção — o “Depois” é medido num render dos stems processados (EQ, dinâmica, saturação, fader, automação, mutes). Masking no tempo (por secção, antes → depois), botão **Ouvir o conflito** (solo dos dois + loop), A/B com/sem correção e correção editável (corte, frequência, Q). Tonalidade do master vs perfil do estilo treinado e vs referência. **Fase entre stems** (kick × baixo, camadas, pares L/R) com inversão de polaridade e alinhamento ao sub-milissegundo. Compatibilidade mono por stem. Profundidade percebida (reverb + pre-delay, nível, brilho, compressão). Histórico do score por versão. |
| **Master** | **Estilo musical** (Kizomba, Semba, Kuduro, Afro House, House, Ghetto Zouk, Tarraxinha, Zouk…) com o perfil aprendido na aba Estilos — curva tonal, loudness, densidade, largura, graves mono — mais o **caráter** (Transparent, Warm, Punchy…). Cadeia adaptativa e reordenável: EQ tonal, EQ dinâmico, multibanda (crossovers Linkwitz-Riley), glue, saturação, M/S com graves em mono, soft clipper e limiter true-peak com look-ahead. Alvo LUFS iterativo (−14 a −7 ou custom) com correção automática de true peak. 10 estilos (Transparent, Warm, Punchy, Wide, Aggressive, Analog, Modern, Streaming, Club, Radio). |
| **Referências** | Até 3 faixas. Diferença por banda após loudness match, LUFS, LRA, largura, correlação. Controlo de influência 0–100 % e aplicação em Mix e/ou Master. |
| **Comparar** | Original / Mix / Master / Referência com **loudness match**, sincronizados, troca instantânea. Espectros sobrepostos, “o que mudou”, 4 alternativas da IA (Natural, Modern, Aggressive, Wide) para alternar sem renderizar. |
| **Medição** | LUFS-I/S/M (BS.1770-4), true peak exato (sinc Kaiser longo a 32× nos picos candidatos — o 4× do BS.1770 subestima até ~0,7 dB a 44,1 kHz), LRA, PLR, crest, correlação, vectorscope, espectro ao vivo. **Mix Quality Score ancorado em referências externas** (ver abaixo). |
| **Export** | WAV 16 (dither TPDF) / 24 / 32-bit float, AIFF, FLAC (codificador próprio, lossless verificado), MP3 320; 44,1 / 48 / 88,2 / 96 kHz. Master, premaster, stems processados, instrumental, acapella, TV mix, performance mix, versões dedicadas por plataforma (Spotify, Apple Music, YouTube, Tidal, Club, Rádio), relatório de QC e sessão JSON — num ZIP. **Metadados** em todos os formatos: título, artista, álbum, ano, género, ISRC (validado), UPC/EAN (validado), compositor, copyright — BWF `bext` com loudness R128, `LIST/INFO`, `aXML` com ISRC (EBU Tech 3352), ID3v2.3 no MP3, Vorbis comments no FLAC. |
| **Codecs** | Pré-escuta do master **depois** do codec (MP3 320/128, AAC e Opus quando o browser os suporta): true peak e overs pós-codec, LUFS, perda de agudos, e um botão que aplica o **ceiling seguro** calculado. |
| **Álbum · DDP** | Alinhamento de várias masters: ordem, pausas, fades, ISRC por faixa, UPC, **igualar loudness** do álbum respeitando o ceiling, escuta com as pausas. Export: masters em ZIP, **WAV + CUE** e **DDP 2.0** (DDPID, DDPMS, PQDESCR, IMAGE.DAT, CHECKSUM.MD5) com verificação independente do que foi escrito. |
| **Projeto** | **Versões guardadas** (decisões, métricas e score de cada uma), recuperação da sessão depois de um crash, e **projeto completo num ficheiro `.mixmind`** (ZIP com o áudio original + todas as decisões, versões, automação e secções) para cópia de segurança ou para levar para outro computador. |
| **Controlo humano** | Tudo editável: override, bloquear stem, bypass, reset para o valor da IA, edição manual. Undo/redo, versões, guarda contra over-processing (Conservador/Normal/Livre). |
| **MIXMIND Master** | Modo “plugin” para masterizar uma mix stereo com 4 macros (Punch, Warmth, Width, Loudness). |
| **Estilos · treino** | Biblioteca por estilo (Kizomba, Semba, Kuduro, Afro House, House, Ghetto Zouk, Tarraxinha, Zouk, Amapiano… ou estilos novos teus). Carregas masters finais e/ou stems pós-fader; ficam **pendentes até aprovares**; ao aprovar, a IA mede e apaga o áudio. Cada estilo ganha um perfil aprendido (curva tonal, loudness, PLR, LRA, largura, graves mono, BPM, punch, balanço por instrumento) e um classificador reconhece o estilo nas sessões novas (com precisão por validação cruzada). Quando o estilo é escolhido, o perfil comanda a mistura e o master. Export/import da biblioteca em JSON. |
| **Modelo do engenheiro** | Treina com o **teu arquivo** (pastas `raw/` e `mix/` por música): aprende o teu balanço, a tua forma de EQ e quanto comprimes cada tipo de stem. Validado deixando uma sessão de fora: só influencia a IA onde bate as regras de base. Também aprende com as sessões que acabas no MIXMIND. |
| **Clientes** | Portal público (`portal.html`) onde clientes enviam masters ou stems com consentimento de direitos; tu aprovas na aba Estilos; ao aprovar, a análise corre no teu browser, só as medidas vão para a biblioteca partilhada e o áudio é apagado do servidor. Backend opcional em Supabase (gratuito). |
| **Assistente** | Pedidos em linguagem natural (“Quero mais punch no kick”, “Quero a voz mais próxima”, “Reduz a agressividade da master”, “Aproxima esta mix da referência”) → proposta com confiança → Aplicar / Rejeitar / Ver porquê. |

### Treinar estilos (aba Estilos)
1. Abre **Estilos**, escolhe o estilo (ou **Novo estilo** — ex.: “Afro House” com base “House”).
2. Arrasta **músicas finais** bem masterizadas desse estilo (5–20 é o ideal) e/ou uma **pasta de stems pós-fader** de uma mistura tua (ensina o balanço entre instrumentos).
3. Revê e carrega em **Aprovar e analisar**. Nada é analisado enquanto estiver pendente.
4. A partir daí, quando uma sessão é reconhecida ou marcada como esse estilo, a IA usa o perfil aprendido: curva tonal e alvo do master, densidade (glue/clipper), largura, graves mono, balanço dos stems e direção da mistura. Tudo aparece explicado no Explain mode.
5. Para todos os utilizadores do site terem o treino: **Exportar biblioteca** → substitui `styles/library.json` no repositório.

Também podes juntar o master atual de uma sessão à biblioteca (“Adicionar o master atual”).

Inclui uma **sessão de demonstração** (Kizomba, 94 BPM, F♯ menor, 15 stems sintetizados no browser, com nomes errados de propósito) para experimentar sem ficheiros.

---

### Loja, contas e licenças (v1.8)
A pasta **`server/`** traz a loja completa: página de vendas, checkout (cartão via Stripe Checkout, PayPal, transferência bancária em Portugal e em Angola com envio de comprovativo), área de cliente, administração (transferências e comprovativos, encomendas, clientes, licenças, subscrições, configurações, textos legais e emails, equipa com 2FA e permissões, auditoria) e a **API de licenças** usada pela app. Node 22 sem dependências, SQLite.

- **Correr em modo de testes:** `ADMIN_EMAIL=… ADMIN_INITIAL_PASSWORD=… npm run loja` → <http://localhost:8790> (pagamentos simulados, dados bancários de exemplo, emails retidos no painel). Opcional: `npm run loja:demo` cria clientes e compras de demonstração.
- **Na app**, o licenciamento só liga quando `config.js` tem `LICENSE_API` (e `LICENSE_PUBLIC_KEY`). Sem isso tudo funciona como antes. Com isso: **Definições → Licença** para ativar; sem licença a app fica em demonstração (exportação limitada a 60 s em MP3, configurável).
- **Produção:** ver [`docs/LICENCIAMENTO.md`](docs/LICENCIAMENTO.md) — arquitetura, segurança, Stripe/PayPal, instalação, cópias de segurança e a **lista do que falta configurar** (credenciais, dados bancários, câmbios, impostos, textos legais validados, email). API e exemplos desktop: [`docs/API-LICENCAS.md`](docs/API-LICENCAS.md), `examples/desktop/`.
- **Também na v1.8:** vista **Notas do Motor** (todas as decisões com faixa, ajuste e motivo; CSV/TXT), alvos de **radiodifusão** (EBU R128 −23 LUFS/−1 dBTP, ATSC A/85 −24/−2), app **instalável e offline** (service worker) com fontes locais.

### Editor de voz (v1.7)
1. **Voz** no menu (ou o botão **VOZ** no canal da voz no Mixer). A primeira vez, a voz é analisada (~2 s para 2½ min) e a análise fica guardada no projeto.
2. Cada nota é um bloco no piano roll; a linha laranja é o pitch que vai soar e o tracejado o original. As barras amarelas mostram quanto falta para a nota da escala.
3. **Híbrida**: arrastar na vertical muda a nota (encaixa na escala; Alt = livre), na horizontal move no tempo, pelas pontas estica; duplo clique centra. ↑ ↓ meio-tom (Alt: 10 cents), ← → mover, Delete cala, Ctrl+A tudo.
4. No painel da direita: centro, drift, vibrato original e acrescentado, formantes, ganho, mover, duração e glide da nota ou da seleção.
5. **Sugestão da IA** centra as notas desafinadas (intensidade ajustável) e deixa o resto; **Harmonia** cria um stem de backing vocal com 3ª/4ª/5ª/6ª/oitava na escala.
6. A voz editada entra no stem antes do EQ, compressão e sends — mistura, master, exports e medições já a usam. O monitor **Original** (tecla 1) continua a ser a gravação crua. Tudo se desfaz com Ctrl+Z e fica guardado no projeto.

### Mix Quality Score ancorado (v1.6)
O score já não compara a mistura com as próprias decisões da IA. Cada critério usa a âncora externa mais forte disponível e mostra-a na Análise:
1. **estilo treinado** — balanço por papel, curva tonal ± desvio, PLR, largura e graves mono medidos nas tuas músicas aprovadas;
2. **faixa de referência** — curva tonal, PLR e largura;
3. **norma objetiva** — alvo de entrega (LUFS/ceiling), correlação e mono, regras de balanço por papel.
O masking usa a **medição real depois do processamento** quando está atualizada (senão a previsão da simulação, e o score diz qual). Há um critério novo, **Tonal Balance**, e recomendações para aproximar o balanço da âncora.

### Modelo do engenheiro (o teu arquivo)
1. Organiza as músicas assim: `Arquivo/<música>/raw/…` (stems brutos) e `Arquivo/<música>/mix/…` (os mesmos stems já misturados, bounce pós-fader). Também servem os nomes `bruto`, `original`, `multitrack` e `bounce`, `pós-fader`, `final`, `prints`.
2. Estilos → **Treinar com o meu arquivo** → escolhe a pasta `Arquivo`. Cada stem bruto é emparelhado com o misturado pelo nome (ex.: `03_Bass DI.wav` ↔ `Bass DI_mix.wav`); os que não emparelham aparecem em “Ver sessões”.
3. Com 3+ sessões o modelo ativa. O painel mostra o erro em sessões que o modelo **não viu** face à regra de base — e o peso na IA depende disso (zero se não bater a regra).
4. **Esta sessão**: depois de medires a mistura (Análise → Depois), junta a sessão atual ao modelo — aprende com o que fazes no próprio MIXMIND.
Exporta/importa o modelo em JSON (só medidas, sem áudio).

### Backend para clientes (Supabase) — opcional
Sem isto, tudo continua 100 % local. Com isto: portal de envio para clientes, moderação na aba Estilos e uma biblioteca de estilos partilhada por todos os visitantes do site.
1. Cria um projeto grátis em [supabase.com](https://supabase.com).
2. **SQL Editor** → cola e corre `supabase/schema.sql` (tabelas, regras RLS e o bucket privado `submissions`).
3. **Authentication → Users → Add user**: cria o teu utilizador admin (email + palavra-passe). No fim do SQL, troca `o-teu-email@exemplo.com` pelo teu email e corre essa linha.
4. **Project Settings → API**: copia a *Project URL* e a chave *anon public* para `config.js` e faz push. (Para experimentar só no teu browser: Estilos → Clientes → Configurar.)
5. Partilha `https://<utilizador>.github.io/<repo>/portal.html` com os clientes. Os envios aparecem em Estilos → **Rever envios pendentes** (depois de “Entrar como admin”).

Segurança: a chave *anon* é pública por natureza. As regras RLS só deixam os clientes **criar** envios pendentes e **enviar** áudio para `incoming/`; não conseguem ler nada. Só o email da tabela `admins` lê, aprova, apaga e publica. Ao aprovar, o áudio é apagado do servidor e a biblioteca partilhada guarda só medidas. Recomendado: em Authentication → Settings, desliga o registo público de utilizadores e ativa CAPTCHA se o portal começar a receber spam.

### Velocidade (v1.6)
- **WebAssembly** (`wasm/mm_dsp.c`, ~5 KB, embutido em `js/core/wasm-bin.js` — sem build para o utilizador): FFT real das análises e medições ~3× mais rápida, true peak ~2,9×, deteção de pitch do editor de voz com SIMD. O loudness ficou em JavaScript, que é mais rápido para esse filtro recursivo (medido). Recompilar: `npm run build:wasm` (precisa de clang com alvo wasm32).
- **Cache por stem**: o primeiro render guarda a saída dos stems pesados (até ao fader); nos renders seguintes os stems inalterados não voltam a ser processados — mexer num stem só re-renderiza esse. A medição “Depois” também só mede os stems que mudaram. Orçamento de memória automático (Definições → Motor de IA, com botão para limpar).

### Testes automáticos
```bash
npm install              # só para os testes (Playwright); a app não precisa
npm run test:dsp         # DSP, formatos, entrega/DDP, wasm, modelo do engenheiro (Node, sem browser)
npm run test:tune        # editor de voz: precisão de pitch, formantes, tempo, ganho, harmonia (voz sintética)
npm run test:e2e         # sessão demo completa no Chromium
npm run test:cloud       # portal → aprovação → biblioteca, contra um Supabase falso (tests/mock-supabase.py)
npm run test:loja        # loja e licenças: 12 validações obrigatórias + extras, interface no Chromium,
                         # licença na app (ECDSA no browser) e exemplos desktop (Node e C++/OpenSSL)
npm run bench            # JavaScript vs WebAssembly
```
Correm a cada push no GitHub Actions (`.github/workflows/tests.yml`).

### Entrega a clientes: DDP
O DDP é escrito segundo a estrutura DDP 2.0 e verificado de forma independente (as estruturas são relidas e o áudio comparado com o WAV+CUE). Mesmo assim, **antes de enviar para fábrica, abre o DDP num leitor de DDP** (ex.: HOFA DDP Player, Sonoris DDP Player) e confirma faixas, pausas, ISRC e UPC.

---

## Publicar no GitHub Pages

O projeto é estático (HTML + CSS + JavaScript, sem build). Duas formas:

### A) Pelo site do GitHub (mais simples)
1. No repositório (ex.: `juninhopiradex-beep/Mixmastermysong`), carrega **o conteúdo desta pasta** para a raiz do branch `main` (incluindo `index.html`, `css/`, `js/`, `assets/`, `.nojekyll`).
2. *Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)`*.
3. Em ~1 minuto fica disponível em `https://juninhopiradex-beep.github.io/Mixmastermysong/`.

### B) Com GitHub Actions (já incluído)
1. Carrega a pasta, incluindo `.github/workflows/pages.yml`.
2. *Settings → Pages → Source: GitHub Actions*.
3. Cada `push` para `main` publica automaticamente.

### Correr localmente
```bash
cd mixmind
python3 -m http.server 8080
# abre http://localhost:8080
```
(Também abre com duplo clique em `index.html` no Chrome/Edge, mas um servidor local é mais fiável.)

**Browsers:** Chrome, Edge, Brave, Opera (recomendado) e Firefox recentes; Safari 16.4+. É necessário suporte a AudioWorklet.

---

## Atalhos

| Ação | Tecla |
|---|---|
| Play / pausa | Espaço |
| Ouvir Original / Mix / Master / Referência | 1 · 2 · 3 · 4 |
| Loudness match on/off | L |
| Desfazer / refazer | Ctrl+Z · Ctrl+Shift+Z |
| Guardar versão | Ctrl+S |
| Paleta de comandos | Ctrl+K |
| Avançar / recuar 5 s (1 s com Shift) | → · ← |
| Mute / Solo do stem selecionado | M · S |
| Fader/pan fino · valor da IA | Shift+arrastar · duplo clique |

---

## Estrutura

```
index.html                   a app
portal.html                  portal público de envio para clientes (precisa do backend)
config.js                    chaves do Supabase (opcional; vazio = tudo local)
css/styles.css               design system
js/core/dsp.js               FFT, biquads RBJ e "matched", FIR de fase linear, ponderação K, LUFS/LRA, true peak, correlação
js/core/wasm.js · wasm-bin.js  ponte e binário WebAssembly (fonte: wasm/mm_dsp.c)
js/core/project.js           ficheiro de projeto .mixmind, recuperação de sessão
js/core/sections.js          estrutura editável e mutes por secção
js/core/cloud.js             backend para clientes (REST do Supabase)
js/core/worklets.js          AudioWorklets: compressor, limiter TP, transient shaper, EQ dinâmico, medidor BS.1770
js/core/session.js           estado, importação, pipeline da IA, undo/redo, versões, IndexedDB
js/audio/analysis.js         features por stem, classificação, problemas de importação, BPM, tom, estrutura, género
js/audio/ai.js               decisões de mistura, masking, automação, score, assistente, alternativas
js/audio/engine.js           grafo de áudio (tempo real e offline idênticos), render, medição
js/audio/master.js           mastering engine, estilos, alvo LUFS iterativo, referências, plataformas
js/audio/styles.js           biblioteca de estilos: características, perfis aprendidos, classificador, export/import
js/audio/export.js           WAV/AIFF/FLAC/MP3, ZIP, QC, relatório
js/audio/delivery.js         metadados (BWF bext, LIST/INFO, aXML, ID3, Vorbis), ISRC/UPC, pré-escuta de codecs
js/audio/album.js            modo álbum, CUE, DDP 2.0 e verificação
js/audio/insight.js          medição "Depois", masking no tempo, fase, tonalidade
js/audio/stemcache.js        cache por stem dos renders
js/audio/engineer.js         modelo do engenheiro (o teu arquivo)
js/audio/tune.js             editor de voz: pitch (YIN), notas, escalas, marcas de período e render PSOLA
js/vendor/lame.min.js        codificador MP3 lamejs (LGPL — ver js/vendor/LAMEJS-LICENSE.txt)
js/audio/demo.js             sessão de demonstração sintetizada
js/ui/…                      interface (vistas: importar, mixer, arranjo, análise, automação, master, comparar, referências, exportar, definições, plugin, estilos, álbum)
styles/library.json          biblioteca de estilos publicada com o site (vazia por omissão)
supabase/schema.sql          tabelas, RLS e bucket do backend de clientes
wasm/                        fonte C dos núcleos WebAssembly e script de compilação
tests/                       testes (Node, Chromium e Supabase falso)
docs/ARQUITETURA.md          proposta técnica completa (30 componentes) e roadmap
docs/AUDITORIA.md            auditoria de áudio: causas do som "de tubo", correções e medições
docs/LICENCIAMENTO.md        loja, pagamentos, licenças: arquitetura, segurança, instalação, pendentes de produção
docs/API-LICENCAS.md         API /api/v1 e formato do comprovativo assinado
js/core/license.js           licença na app: ativação, verificação ECDSA (WebCrypto), demonstração
js/core/pwa.js · sw.js       app instalável e offline
js/ui/views/notes.js         Notas do Motor
server/                      loja, área de cliente, administração e API de licenças (Node 22, SQLite)
  src/                       servidor, rotas, pagamentos (Stripe, PayPal, transferências), licenças, tarefas
  public/                    páginas (loja, checkout, conta, admin) — sem scripts inline (CSP)
  migrations/ · test/        esquema SQL · testes (API e interface)
  scripts/                   backup.mjs, seed-demo.mjs
  .env.example               variáveis (sem segredos)
examples/desktop/            integração das licenças: Node, C++/OpenSSL, JUCE
```

---

## Notas honestas sobre esta versão

- **“IA” nesta versão = DSP + regras de engenharia + estatística + aprendizagem** (perfis por estilo, classificador gaussiano e o modelo do engenheiro — regressão ridge — treinados com as tuas músicas). Não há redes neuronais profundas. A classificação, as decisões de mistura e o assistente são determinísticos e explicáveis. A arquitetura está preparada para trocar cada decisor por um modelo treinado (ver `docs/ARQUITETURA.md`, secções 4, 5 e 25–28).
- O **MP3** usa o codificador `lamejs` (LGPL), incluído em `js/vendor/` — funciona offline. A pré-escuta AAC depende do browser e do sistema (o Chromium em Linux não tem codificador AAC; a app só mostra os codecs disponíveis).
- Sessões muito longas (30+ stems de 6+ minutos) podem esgotar a memória do separador; usa a qualidade de análise “Rápida”.
- O editor de voz é **monofónico** (uma nota de cada vez — voz, sopros, baixo); acordes e coros num só stem não são separados. Correções grandes (mais de ±5 meios-tons) começam a soar processadas, como em qualquer PSOLA.
- **Licenciamento numa app web é dissuasão, não DRM**: o código corre no navegador do utilizador. O comprovativo é assinado (ECDSA) e ligado ao computador, mas quem altere o JavaScript consegue contorná-lo. Numa app nativa assinada a mesma verificação é mais robusta (exemplos em `examples/desktop/`).
- O **motor de IA com chave API própria** ainda não existe — aparece como “Em breve” na página de vendas.
- O browser não permite plugins **VST3/AU/AAX**. O motor foi desenhado para ser portado para JUCE (C++) com a mesma arquitetura — ver roadmap.
- Os projetos, a biblioteca de estilos e o modelo do engenheiro ficam guardados no IndexedDB **deste browser** (Definições → Privacidade para apagar projetos). Para levar um projeto para outro computador usa o ficheiro `.mixmind`. A biblioteca pode ser partilhada pelo backend opcional ou por `styles/library.json`.
- A cache por stem dá um resultado igual ao render completo a −98 dB (diferenças de arredondamento em vírgula flutuante), inaudível.
- O modelo do engenheiro só é tão bom quanto o arquivo: precisa de 3+ sessões com nomes de ficheiros emparelháveis, e com poucas sessões o peso dele é baixo — de propósito.

© MIXMIND by Piradex · BeatFreak Studio
