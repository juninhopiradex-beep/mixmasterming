# MixMind — AI Mixing & Mastering Environment

**AI proposes. Engineer decides.**

MixMind é um ambiente de mistura e masterização inteligente baseado em stems, que corre **inteiramente no browser**. Importa os teus stems, a IA identifica cada instrumento (pelo nome *e* pelo áudio), percebe a estrutura da música, propõe uma direção sonora e executa a mistura e o master — com cada decisão explicada, editável e comparável com loudness match.

O áudio **nunca sai do teu computador**: análise, processamento, render e export acontecem localmente (Web Audio + AudioWorklets + DSP em JavaScript).

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
| **Automação** | Vocal rider frase a frase (distância alvo vs instrumental, respirações), send de reverb por secção, filtro do pad, delay throws nos adlibs, largura do master por secção. Edição manual por desenho que **prevalece sobre a IA**. |
| **Master** | Cadeia adaptativa e reordenável: EQ tonal, EQ dinâmico, multibanda (crossovers Linkwitz-Riley), glue, saturação, M/S com graves em mono, soft clipper e limiter true-peak com look-ahead. Alvo LUFS iterativo (−14 a −7 ou custom) com correção automática de true peak. 10 estilos (Transparent, Warm, Punchy, Wide, Aggressive, Analog, Modern, Streaming, Club, Radio). |
| **Referências** | Até 3 faixas. Diferença por banda após loudness match, LUFS, LRA, largura, correlação. Controlo de influência 0–100 % e aplicação em Mix e/ou Master. |
| **Comparar** | Original / Mix / Master / Referência com **loudness match**, sincronizados, troca instantânea. Espectros sobrepostos, “o que mudou”, 4 alternativas da IA (Natural, Modern, Aggressive, Wide) para alternar sem renderizar. |
| **Medição** | LUFS-I/S/M (BS.1770-4), true peak (sobreamostragem 4×), LRA, PLR, crest, correlação, vectorscope, espectro ao vivo, Mix Quality Score com recomendações acionáveis. |
| **Export** | WAV 16 (dither TPDF) / 24 / 32-bit float, AIFF, FLAC (codificador próprio, lossless verificado), MP3 320; 44,1 / 48 / 88,2 / 96 kHz. Master, premaster, stems processados, instrumental, acapella, TV mix, performance mix, versões dedicadas por plataforma (Spotify, Apple Music, YouTube, Tidal, Club, Rádio), relatório de QC e sessão JSON — num ZIP. |
| **Controlo humano** | Tudo editável: override, bloquear stem, bypass, reset para o valor da IA, edição manual. Undo/redo, versões, guarda contra over-processing (Conservador/Normal/Livre). |
| **MixMind Master** | Modo “plugin” para masterizar uma mix stereo com 4 macros (Punch, Warmth, Width, Loudness). |
| **Estilos · treino** | Biblioteca por estilo (Kizomba, Semba, Kuduro, Afro House, House, Ghetto Zouk, Tarraxinha, Zouk, Amapiano… ou estilos novos teus). Carregas masters finais e/ou stems pós-fader; ficam **pendentes até aprovares**; ao aprovar, a IA mede e apaga o áudio. Cada estilo ganha um perfil aprendido (curva tonal, loudness, PLR, LRA, largura, graves mono, BPM, punch, balanço por instrumento) e um classificador reconhece o estilo nas sessões novas (com precisão por validação cruzada). Quando o estilo é escolhido, o perfil comanda a mistura e o master. Export/import da biblioteca em JSON. |
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
index.html
css/styles.css               design system
js/core/dsp.js               FFT, biquads RBJ, ponderação K, LUFS/LRA, true peak, correlação
js/core/worklets.js          AudioWorklets: compressor, limiter TP, transient shaper, EQ dinâmico, medidor BS.1770
js/core/session.js           estado, importação, pipeline da IA, undo/redo, versões, IndexedDB
js/audio/analysis.js         features por stem, classificação, problemas de importação, BPM, tom, estrutura, género
js/audio/ai.js               decisões de mistura, masking, automação, score, assistente, alternativas
js/audio/engine.js           grafo de áudio (tempo real e offline idênticos), render, medição
js/audio/master.js           mastering engine, estilos, alvo LUFS iterativo, referências, plataformas
js/audio/styles.js           biblioteca de estilos: características, perfis aprendidos, classificador, export/import
js/audio/export.js           WAV/AIFF/FLAC/MP3, ZIP, QC, relatório
js/audio/demo.js             sessão de demonstração sintetizada
js/ui/…                      interface (vistas: importar, mixer, arranjo, análise, automação, master, comparar, referências, exportar, definições, plugin)
styles/library.json          biblioteca de estilos publicada com o site (vazia por omissão)
docs/ARQUITETURA.md          proposta técnica completa (30 componentes) e roadmap
docs/AUDITORIA.md            auditoria de áudio: causas do som "de tubo", correções e medições
```

---

## Notas honestas sobre esta versão

- **“IA” nesta versão = DSP + regras de engenharia + estatística + aprendizagem por estilo** (perfis medidos e classificador gaussiano treinados com as tuas músicas). Não há redes neuronais profundas. A classificação, as decisões de mistura e o assistente são determinísticos e explicáveis. A arquitetura está preparada para trocar cada decisor por um modelo treinado (ver `docs/ARQUITETURA.md`, secções 4, 5 e 25–28).
- O **MP3** usa o codificador `lamejs` carregado de um CDN na primeira exportação — precisa de internet nesse momento. WAV, AIFF e FLAC funcionam offline.
- Sessões muito longas (30+ stems de 6+ minutos) podem esgotar a memória do separador; usa a qualidade de análise “Rápida”.
- O browser não permite plugins **VST3/AU/AAX**. O motor foi desenhado para ser portado para JUCE (C++) com a mesma arquitetura — ver roadmap.
- Os projetos e a biblioteca de estilos ficam guardados no IndexedDB **deste browser** (Definições → Privacidade para apagar projetos). Uma página pública onde clientes enviam músicas para aprovação precisa de um servidor — no GitHub Pages, partilha-se o treino via `styles/library.json`.

© MixMind · BeatFreak Studio
