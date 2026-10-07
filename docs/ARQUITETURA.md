# MIXMIND — Proposta técnica e arquitetura

> **AI proposes. Engineer decides.** Uma DAW inteligente / AI Mixing & Mastering Environment para engenheiros, produtores e artistas.

Este documento descreve a arquitetura completa do produto — desde a versão web incluída neste repositório (MVP funcional) até ao produto comercial com plugins VST3/AU/AAX e modelos treinados. Para cada componente: **objetivo · funcionamento e algoritmos · entradas → saídas · interação · risco técnico · prioridade · impacto sonoro · estado**.

Legenda de estado: ✅ implementado na versão web · 🟡 parcial / heurístico · 🔜 roadmap.

---

## 1. Arquitetura geral do sistema

**Objetivo.** Separar o que *decide* (inteligência) do que *soa* (DSP), para que cada decisão seja explicável, reversível e substituível por um modelo melhor sem tocar no motor de áudio.

```
            ┌─────────────────────── Interface (vistas, assistente, editores) ───────────────────────┐
            │                                                                                         │
 ficheiros → Importação → Análise (features) → Music Intelligence → Decisores (mix/master/automação) → Estado do projeto
                                                                                                   │           │
                                                       Motor DSP (grafo idêntico em tempo real e offline) ←────┘
                                                                     │
                                         Medição (LUFS/TP/…) → QC → Score → Export
```

- **Estado do projeto** (JSON serializável) é a fonte única de verdade: parâmetros por stem, buses, efeitos, master, automação, direção, flags *manual/locked*.
- **Decisores** escrevem no estado; **o motor** lê do estado. Undo/redo e versões são snapshots do estado.
- **Grafo duplo**: o mesmo construtor gera o grafo em `AudioContext` (ouvir) e `OfflineAudioContext` (render/export) → o que ouves é o que exportas.

**Risco:** baixo. **Prioridade:** P0. **Impacto:** fundação de tudo. **Estado:** ✅ (`js/core/session.js`, `js/audio/engine.js`).

## 2. Módulos principais

| Módulo | Responsabilidade | Ficheiro |
|---|---|---|
| Importação | descodificar, cabeçalhos, pares L/R, mono falso, avisos | `session.js`, `analysis.js` |
| Feature extraction | loudness, espectro, bandas, envolvente, onsets, harmonicidade, f0, estéreo | `analysis.js` |
| Classificação | papel + confiança + alternativas | `analysis.js` |
| Music Intelligence | BPM, downbeat, tom, estrutura, género | `analysis.js` |
| Mix Decision Engine | gain staging → balanço → pan → EQ → dinâmica → espaço → masking → bus | `ai.js` |
| Automation Engine | rider, sends, filtros, largura, curvas internas | `ai.js` |
| Mastering Engine | decisões, alvo iterativo, referência | `master.js` |
| Motor DSP | grafo Web Audio + AudioWorklets | `engine.js`, `worklets.js` |
| Medição/QC/Score | BS.1770, TP, correlação, QC, score | `dsp.js`, `engine.js`, `export.js`, `ai.js` |
| Export | codificadores, ZIP, relatório | `export.js` |
| Assistente | linguagem natural → propostas | `ai.js` |

## 3. Arquitetura DSP

**Objetivo.** Processamento de qualidade profissional, previsível e com latência baixa.

**Canal (stem):** `trim → HPF 24 dB/oit (Butterworth 2×) → EQ (até 6 bandas RBJ) → EQ dinâmico ×2 → de-esser → LPF → LPF automatizado → compressor → compressor série → transient shaper → saturação dry/wet (+ DC block) → sidechain multibanda (LR4 a 120 Hz) → rider → fader → pan → mute/solo → bus de grupo` + sends pós-fader.

**Buses:** drums (com compressão paralela), bass, vocals, music, fx → mix bus (`shelves → glue → saturação`) → premaster.

**Master:** cadeia **reordenável**: `EQ tonal (+7 bandas de referência) → EQ dinâmico → multibanda 3 bandas (LR4) → glue → saturação → M/S (graves mono) → drive → soft clipper (4×) → limiter true-peak`.

**Algoritmos-chave**
- Compressor feed-forward, detetor de pico ligado em estéreo, knee suave, envelope em dB com ataque/release, cálculo por sub-blocos de 8 amostras e interpolação linear de ganho (eficiente e sem zipper).
- Limiter: deteção de **true peak** por interpolação Hermite 4×, mínimo deslizante O(1) (deque monotónica) na janela de look-ahead + média deslizante → ataque garantido dentro do look-ahead, release exponencial, clip de segurança.
- EQ dinâmico (master): energia relativa da banda vs média de longo prazo; corte só acima do alvo.
- Ponderação K e gating BS.1770-4 (integrado, momentary, short-term, LRA).
- Reverbs por convolução com IRs sintetizadas (densidade, damping dependente do tempo, early reflections na room).
- Saturação em AudioWorklet próprio (tube assimétrico, tape, transformer, console, soft clip, exciter, clipper) com oversampling 2× por FIR meia-banda de fase linear, dry/wet alinhados internamente e compensação de latência (PDC) entre stems. (O WaveShaper nativo do Chrome atrasa 128–192 amostras com oversampling e causava filtro em pente — ver `AUDITORIA.md`.)
- Parâmetros dos processadores entregues de forma síncrona na construção (os renders offline não dependem de mensagens).

**Risco:** médio (CPU no browser). **Prioridade:** P0. **Impacto:** direto e total. **Estado:** ✅.

## 4. Arquitetura de Machine Learning (híbrida)

**Princípio:** ML onde a perceção é difícil de formalizar; DSP clássico onde é mais preciso (medição, filtros, loudness, true peak, fase).

| Componente | Abordagem atual (web) | Modelo alvo |
|---|---|---|
| Audio classification / instrument recognition | heurística sobre 20+ features + prior do nome | CNN/Transformer sobre log-mel (ex.: PANNs/AST fine-tuned) + fusão com nome; ONNX Runtime Web/WebGPU |
| Music structure detection | novidade por blocos de 4 compassos + regras de rotulagem | modelo de segmentação (self-similarity + GRU/Transformer) |
| Source characterization | features espectrais e dinâmicas | embeddings de timbre por stem |
| Mix decision model | regras de engenharia por papel/género/direção | regressão de parâmetros DSP condicionada (stem embedding + contexto + direção) |
| Masking detection | sobreposição por bloco × banda de 1/3 oit | modelo psicoacústico (excitação/masking threshold) |
| Reference matching | 7 bandas + LUFS/PLR/largura | embeddings de mix + distância perceptual |
| DSP parameter prediction | fórmulas por papel | rede que prevê parâmetros a partir de pares (raw stem → stem misturado) |
| Generative mix model | — | 🔜 difusão/autoencoder só para propostas, nunca para o áudio final |
| Preference / user feedback learning | aceitações/rejeições guardadas no projeto | aprendizagem de preferências por utilizador e por estilo |

**Estado:** 🟡 (decisores heurísticos explicáveis, prontos a trocar por modelos). **Risco:** alto (dados). **Prioridade:** P1.

## 5. Estrutura dos modelos de IA

- **Classificador de stems:** entrada log-mel 128×T (3 s, hop 10 ms) + metadados (nome tokenizado, canais, silêncio) → backbone CNN (EfficientNet-B0 ou AST pequeno) → pooling de atenção → 28 classes + família; calibração por temperature scaling para a percentagem de confiança.
- **Preditor de parâmetros:** por stem, entrada `[embedding do stem, embedding da mix, papel, hierarquia, direção (9), género]` → cabeças por módulo (HPF Hz, bandas de EQ {f, g, Q}, compressor {thr, ratio, atk, rel}, sends) com *loss* em domínio de parâmetro + *loss* perceptual (diferença multi-resolução STFT, loudness por banda) através de um proxy diferenciável do DSP.
- **Rider/automação:** sequência por blocos de 100 ms (Temporal ConvNet) que prevê ganho relativo dado vocal/instrumental por banda.
- **Master:** regressão da curva tonal-alvo por género/estilo + classificador de estilo a partir de referências.
- Todos os modelos devolvem **valor + confiança + explicação** (atribuição a features), para alimentar o Explain mode.

## 6. Pipeline completo de análise e processamento

1. Descodificar → canais float32; detetar mono falso; cabeçalho (SR/bits).
2. Features por stem (STFT 2048, bandas 1/3 oit por bloco ~100 ms, loudness BS.1770, envolvente 5 ms, onsets, autocorrelação para f0/harmonicidade, correlação/largura).
3. Classificação + problemas (pares, silêncio, clipping, SR).
4. Music Intelligence: BPM (fluxo espectral + autocorrelação com pente de harmónicos e prior), downbeat (energia do bombo), tom (cromagrama + Krumhansl-Schmuckler + desambiguação relativa pelo grave), estrutura, género.
5. Proposta de direção.
6. Decisões de mistura (ver §7) → automação.
7. Render premaster offline → calibração de nível do bus (alvo −18 LUFS).
8. Decisões de master → alvo LUFS iterativo (excerto mais forte + render completo + correção TP).
9. Medição, QC, score, versão.

## 7. Workflow de mixagem (ordem de um engenheiro)

ouvir → compreender a música → arranjo → protagonistas (hierarquia) → **gain staging** (−20 LUFS ativos, pico ≤ −3 dBFS) → **balanço só com faders** (tabela por papel × género × hierarquia × direção; pares L/R −3 dB) → **resolver problemas** (HPF, lama, boxiness, nasal, aspereza, ressonâncias) → **criar espaço** (pan, anti-masking com EQ dinâmico e sidechain) → **dinâmica** (compressão por papel, série na voz, transientes) → **profundidade** (sends por hierarquia, plate/room/hall, pre-delay a 1/32) → **movimento** (automação por secção) → **emoção** (saturação contextual, delay throws) → **mix bus** → comparar com referência → master → QC.

Respeita sempre: stems **bloqueados** e parâmetros com flag **manual**. **Estado:** ✅.

## 8. Workflow de masterização

Análise do premaster (7 bandas normalizadas, PLR, crest, correlação mínima, mono nos graves) → curva-alvo por estilo + género + direção (± referência) → EQ estática pequena + EQ dinâmico (lama 320 Hz, aspereza 3,2 kHz) → multibanda → glue → saturação → M/S (largura limitada se a correlação for baixa) → **drive** → clipper → limiter TP. Ganho do drive encontrado por **método da secante** num excerto de 30 s e confirmado no render completo; se o true peak medido (4×) passar o ceiling, o ceiling interno é corrigido e repete. **Estado:** ✅.

## 9. Sistema de referência

Até 3 faixas; métricas: LUFS, LRA, PLR, crest, largura, correlação, mono < 120 Hz, espectro 128 pontos e 7 bandas normalizadas. **Diferença por banda após loudness match** → EQ de referência no master (`−diff × 0,7 × influência`, limitado a ±3 dB), alvo LUFS interpolado, glue ajustado pela diferença de PLR, largura aproximada. Influência 0–100 %, aplicação em Mix (shelves do mix bus) e/ou Master. A referência **orienta**, não copia. **Estado:** ✅.

## 10. Desenho da interface

Topo: projeto, versões, transporte A/B (Original · Mix · Master · Ref) com loudness match, alvo, estado, undo/redo, **AI Mix & Master**. Navegação por vistas: Importar · Mixer · Arranjo · Análise · Automação · Master · Comparar · Referências · Exportar · MIXMIND Master · Definições. Dock inferior: transporte, timeline com secções clicáveis (loop por secção), medidores LUFS-I/S/M, TP, correlação, GR. Paleta de comandos (Ctrl+K). Estética: escuro premium, vidro, acentos menta→ciano, números monoespaçados. **Estado:** ✅.

## 11. Estrutura de dados do projeto

```jsonc
{
  "project": { "id", "name" }, "sampleRate": 48000, "mode": "stems|master",
  "music": { "bpm", "downbeat", "key", "mode", "meter", "genre", "sections": [{ "name", "start", "end", "startBar", "endBar" }] },
  "stems": [{ "id", "name", "role", "conf", "hier": "P|S|B", "group", "locked", "mute", "solo", "pair", "pairSide",
              "p": { "trim", "fader", "pan", "hpf", "eq": [], "dyn": [], "deess", "lpf", "comp", "comp2", "trans", "sat", "duck", "sendRev", "revType", "sendDly" },
              "ai": { /* cópia do que a IA propôs */ }, "manual": { "fader": true } }],
  "direction": { "tone", "aggr", "era", "space", "width", "polish", "loud", "punch", "sat" },
  "fx": { "plate", "room", "hall", "delay" }, "bus": { "trim", "eq", "glue", "sat", "drumPar" },
  "master": { "target", "ceiling", "style", "width", "order": [], "chain": { "eq", "dyn", "mb", "glue", "sat", "ms", "clip", "lim" }, "manual": {} },
  "automation": [{ "id", "target": { "type", "id", "param" }, "unit", "ai": { "rate", "values" } | { "points" }, "manual": [[["t","v"]]], "enabled": { "ai", "manual" } }],
  "refs": [], "refInfluence": 0.6, "versions": [], "explain": [], "conflicts": [], "confidence": {}
}
```
Persistência: IndexedDB (stems originais + features + snapshot). Export opcional `.mixmind.json`.

## 12. Sistema de presets

- **Género** (17): direção base (9 macros), deltas de balanço por papel, alvo LUFS e estilo de master.
- **Estéticos** (10): Warm Analog, Modern Clean, Radio Ready, Wide Pop, Punchy Club, Smooth Vocal, Deep Low-End, Vintage Soul, Transparent Master, Aggressive Modern — **deltas** sobre a direção, combináveis.
- Os presets são só ponto de partida: a direção final é adaptada à música (densidade do arranjo, crest da bateria, LRA da voz). **Estado:** ✅. 🔜 presets do utilizador e por cliente/estilo aprendidos das sessões aprovadas.

## 13. Sistema de automação

Faixas com curva da IA (densa a 10–100 Hz ou por pontos) e **segmentos manuais que prevalecem**. Agendadas com `setValueCurveAtTime` a partir da posição atual (play/seek/loop) e idênticas no render offline. Faixas visíveis: rider, sends, filtro do pad, delay throws, largura do master; internas: sidechain, EQ dinâmico, de-esser, ducking de reverb/delay. Ferramentas: aceitar IA, suavizar, reduzir pontos, limpar manual, ativar/desativar IA e manual por faixa. **Estado:** ✅.

## 14. Desenho do mixer

Canal com cor por grupo, papel e confiança, chips de módulos (IA vs MANUAL), pan arrastável, fader com escala de DAW e **marcador tracejado do valor proposto pela IA**, medidor pós-fader, valor em dB, sends, S/M/R (ler automação). Master strip com LUFS-I, TP, PLR, GR, LRA e Mix Score. Painel direito: assistente, cadeia do stem selecionado, explicações e confiança. **Estado:** ✅.

## 15. Processamento por instrumento

| Papel | HPF | EQ típica | Dinâmica | Espaço |
|---|---|---|---|---|
| Lead Vocal | 0,55·f0 (70–140 Hz) | lama/nasal/aspereza corretivas, presença 3,5 kHz, ar 10 kHz | FET 3:1 5 ms + Opto 2:1 série, de-esser dinâmico, rider | plate −20 dB, delay 1/4 com ducking |
| Backing/Choir | 110–120 Hz | lama | 3:1 | plate/hall, pan aberto |
| Kick | 28 Hz | peso no fundamental, click 3,8 kHz | 2,5:1 ataque lento, transientes | seco |
| Snare/Clap | 90–140 Hz | corpo 200 Hz | 3:1 | room |
| Hi-hat/Shaker | 320–380 Hz | brilho suave se Warm | — | pan lateral |
| Bass/Sub | 22–30 Hz | lama 160–320 Hz | Opto 4:1, saturação tube | centro, sidechain do kick |
| Guitars/Keys/Synth | 70–110 Hz | lama/boxiness/aspereza | se crest alto | hall, pares abertos |
| Pad/Strings | 90–150 Hz | calor se Warm | — | hall, fundo, filtro automatizado |
| FX/Risers | 150 Hz | — | — | hall, fundo |

## 16. Processamento do mix bus

Shelves suaves (tone/era), **glue** 2:1 ataque 30 ms (GR alvo pela direção Dynamic↔Loud e Aggressive), saturação tape/transformer quando Saturated > 35, **compressão paralela** da bateria quando Punchy > 55. Nível do bus calibrado para −18 LUFS no premaster. **Estado:** ✅.

## 17. Mastering engine

Ver §8. Saídas: buffer master, métricas, QC, explicações por módulo, ganho de drive, correção de ceiling. Estilos: Transparent, Warm, Punchy, Wide, Aggressive, Analog, Modern, Streaming, Club, Radio. **Estado:** ✅.

## 18. Metering

Tempo real (AudioWorklet): LUFS-M/S/I com gating, true peak (Hermite 4×) com hold, picos L/R, correlação. Offline: LUFS-I/S/M máx., LRA, PLR, crest, true peak (FIR polifásico 4×), DC, clipping, cliques (picos isolados de 2.ª diferença), silêncio na cabeça/cauda, mono < 120 Hz, correlação mínima por segundo, espectro, loudness por secção. Visual: vectorscope, espectro ao vivo, espectros sobrepostos. 🔜 espectrograma. **Estado:** ✅.

## 19. Export engine

Render offline ao sample rate pedido (44,1–96 kHz) com o mesmo grafo; codificadores WAV (16 + TPDF, 24, 32f), AIFF, **FLAC** (preditores fixos ordem 0–4 + Rice, CRC8/CRC16 — verificado bit-a-bit), MP3 320 (lamejs). Variantes por filtro de stems (instrumental, acapella, TV, performance, stems processados). Versões por plataforma re-masterizadas ao alvo (não só baixadas). ZIP sem compressão com CRC32. Relatório de QC HTML (imprimível para PDF). **Estado:** ✅.

## 20. Sistema de versionamento

Snapshots completos do estado (Mix V1, V2…), com buffers renderizados das versões recentes para A/B instantâneo; undo/redo com 300 passos; alternativas da IA (Natural, Modern, Aggressive, Wide) aplicadas ao vivo sem render. **Estado:** ✅.

## 21. Arquitetura VST3 / AU / AAX / CLAP

🔜 Port para **JUCE (C++)**:
- `MIXMINDCore` (biblioteca C++ partilhada): os mesmos módulos DSP (compressor, limiter TP, EQ dinâmico, multibanda LR4, M/S, saturação, medidor BS.1770), com testes de paridade contra os renders da versão web.
- **MIXMIND Master** (plugin de inserção no master) — primeiro produto: macros Punch/Warmth/Width/Loudness, análise de 10 s e aprendizagem com referência (UI já desenhada na vista “MIXMIND Master”).
- **MIXMIND Bridge** (plugin por pista, envia áudio para a app standalone via memória partilhada) para o fluxo completo de stems dentro da DAW.
- Build remoto com GitHub Actions/Codemagic (macOS universal + Windows), assinatura e notarização; AAX via PACE.

**Risco:** médio-alto. **Prioridade:** P2.

## 22. Estratégia de performance em tempo real

- Topologia **preguiçosa**: só são criados os módulos ativos; a cadeia é religada quando muda.
- Compressores com cálculo por sub-blocos; limiter com deque O(1); biquads automatizados em *k-rate*.
- `AudioContext` **suspenso quando parado** (os worklets deixam de consumir CPU durante análise e renders).
- Automação densa pré-calculada e agendada (sem mensagens por bloco).
- Renders de stems individuais constroem só os stems filtrados.

## 23. Processamento CPU / GPU

Hoje: DSP em CPU (audio thread + worklets; análise no main thread com *yield* para a UI). 🔜 GPU via **WebGPU/ONNX Runtime Web** para os modelos de classificação e predição de parâmetros; DSP de áudio mantém-se em CPU (latência determinística). Na versão nativa: inferência em CoreML/DirectML fora do audio thread.

## 24. Sistema de caching

Features por stem guardadas (IndexedDB) → reabrir não re-analisa. Premaster reutilizado quando só o master muda. IRs de reverb e curvas de saturação em cache. Buffers renderizados das últimas versões em memória. 🔜 cache de análise por *hash* do ficheiro.

## 25. Estratégia de treino dos modelos

**Implementado (v1.1) — aba Estilos:** exemplos por estilo (masters e stems pós-fader), aprovação obrigatória antes da análise, características por música (curva 1/3 oit., 7 bandas, LUFS, LRA, PLR, crest, largura por região, graves mono, punch, BPM, densidade de onsets, centróide, macro-dinâmica), perfis robustos (medianas e percentis), classificador gaussiano diagonal com validação cruzada leave-one-out, e aplicação do perfil às decisões de mistura (balanço, direção) e master (curva-alvo, alvo LUFS, glue/clipper, largura, mono). Os passos seguintes mantêm-se:

1. **Pré-treino** do classificador em datasets públicos de instrumentos/stems.
2. **Afinação** com stems reais por estilo (Kizomba, Semba, Kuduro, Afrobeat, Amapiano…).
3. **Preditor de parâmetros** treinado em pares (stem raw → stem misturado) com inversão de parâmetros por otimização sobre o DSP diferenciável.
4. **Aprendizagem de preferências**: cada aceitação/rejeição/edição manual é um sinal (pairwise) — ranking por estilo e por utilizador.
5. Avaliação: testes de escuta ABX cegos com loudness match + métricas objetivas (score, distância a referências do estilo).

## 26. Datasets necessários

- Multitracks com mixes finais (MedleyDB, MUSDB18-HQ, Cambridge “Mixing Secrets”, Open Multitrack Testbed) — com atenção às licenças.
- **Biblioteca de estilos MIXMIND**: submissões de clientes (stems + mix + master + níveis), **pendentes até aprovação** por um administrador antes de entrarem no treino.
- Referências comerciais **apenas para extração de métricas** (sem redistribuição).

## 27. Criação de ground truth de mixes

Para cada sessão aprovada: parâmetros finais por stem (extraídos da sessão do engenheiro ou estimados por inversão), loudness relativo por papel e secção, curvas de automação, master final; anotação de estrutura e papel por um engenheiro; versões múltiplas do mesmo engenheiro para medir variância aceitável.

## 28. Aprendizagem com mixes profissionais

Estatísticas por estilo (balanço por papel, curva tonal, PLR, largura, profundidade) alimentam diretamente as tabelas de presets; os modelos aprendem desvios condicionados à música. O utilizador vê sempre de onde vem a decisão (“relação típica de Kizomba para baixo”).

## 29. Proteção contra over-processing

- **Guarda** configurável: EQ máx. (±2/4/8 dB), nº de bandas (2/4/6), GR máx. (3/5/9 dB), saturação máx.
- Saturação em no máximo ~35 % dos canais; compressão só quando o papel/crest justifica.
- EQ dinâmico em vez de cortes estáticos para masking; cortes só quando o protagonista toca.
- Master: alvo de PLR por loudness, QC de over-limiting, limitação da largura quando a correlação é baixa.
- Comparação **sempre** com loudness match. **Estado:** ✅.

## 30. Roadmap — do MVP ao produto comercial

| Fase | Entregas |
|---|---|
| **0 · MVP web (este repositório)** | pipeline completo no browser, decisores heurísticos explicáveis, export com QC, demo |
| **1 · Beta web** | biblioteca de estilos com aprovação de admin, feedback de utilizadores, classificador neural (ONNX/WebGPU), espectrograma, presets do utilizador |
| **2 · MIXMIND Master plugin** | JUCE VST3/AU (macOS/Windows), paridade DSP com a web, licenças offline |
| **3 · Modelos de decisão** | preditor de parâmetros treinado por estilo, rider neural, aprendizagem de preferências |
| **4 · Integração DAW** | MIXMIND Bridge (envio/receção de stems: Pro Tools, Cubase/Nuendo, Logic, Studio One, Ableton, Reaper), AAX, CLAP |
| **5 · Comercial** | contas/planos, processamento em servidor privado opcional, colaboração e revisão com clientes |
