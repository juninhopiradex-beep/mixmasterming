# MIXMIND by Piradex — Auditoria de áudio (v1.1 → v1.7)

Auditoria técnica da cadeia completa (mistura → mix bus → master → export), feita com medições objetivas no Chromium (o mesmo motor Web Audio que corre no browser), validadas com o `ebur128` do ffmpeg.

## Problema reportado: master com som “de tubo”

### Causa 1 — filtro em pente na saturação (principal)
O `WaveShaperNode` do Chrome com oversampling **atrasa o sinal e não compensa**: 128 amostras (2×) e 192 amostras (4×), medido. A saturação misturava esse sinal atrasado com o sinal limpo (dry/wet):

| Onde | Mistura | Atraso | Efeito |
|---|---|---|---|
| Master (todos os estilos com saturação) | 50 % / 50 % | 192 amostras (4 ms) | cancelamentos totais a 125, 375, 625 Hz… (a cada 250 Hz) |
| Mix bus (quando “Saturated” > 35, ex. Kizomba) | 50 % / 50 % | 192 amostras | idem, em série com o anterior |
| Stems (baixo, voz, tarola…) | 30–40 % | 128 amostras | pente parcial + stem desalinhado 2,7 ms do resto |

Dois filtros em pente em série = som oco/“tubo”.

**Correção:** saturação reescrita como AudioWorklet próprio (`mm-sat`): oversampling 2× com FIR meia-banda de fase linear (47 taps), **dry e wet alinhados dentro do processador**, latência fixa de 23 amostras, e **compensação de latência (PDC)** entre stems.
**Medido depois:** resposta em frequência a 50 % de mistura plana em ±0,03 dB (40 Hz–16 kHz); dois stems (um saturado) chegam alinhados à amostra.

### Causa 2 — “graves em mono” com rotação de fase
O M/S filtrava só o canal lateral (Butterworth 4.ª ordem), rodando a fase contra o centro: vale de −14 dB perto dos 126 Hz no canal esquerdo.
**Correção:** “bass mono” correto — lateral com HP Linkwitz-Riley (LR4) e centro com o all-pass equivalente. **Medido:** resposta plana acima de 250 Hz (−0,22 dB), entrada mono 100 % plana (±0,07 dB).

### Causa 3 — parâmetros que chegavam tarde aos processadores
Nos renders offline, os parâmetros enviados por mensagem aos AudioWorklets podiam chegar depois do início: parte da música era processada com valores por omissão (ex.: compressor 3:1 a −18 dB). Resultado: master inconsistente entre renders.
**Correção:** todos os processadores recebem os parâmetros de forma síncrona na construção (`processorOptions`). **Medido:** resultados idênticos e reprodutíveis.

## Outras correções de engenharia

| Área | Antes | Depois |
|---|---|---|
| Multibanda | banda grave sem compensação de fase do 2.º cruzamento | all-pass de compensação; soma plana ±0,07 dB |
| Glue / multibanda | threshold “teórico”: redução real diferente da pedida | threshold calibrado simulando o detetor no próprio áudio: pedido 1,2 dB → real 1,37 dB; 2,2 → 2,46 |
| Alvo de loudness | podia subir o ganho até +40 dB quando o estilo não atingia o alvo (esmagamento) | para quando +1 dB de ganho já quase não sobe o loudness; o QC avisa “Alvo não atingido sem esmagar” |
| Limiter | release único | release duplo dependente do programa (60/200 ms, nível sustentado 1,5 s); 0,01 % THD a 60 Hz com 6 dB de redução |
| True peak | filtro de 48 taps (subestimava ~0,4 dB) | 96 taps Kaiser β=8 — igual ao ffmpeg (−0,82 vs −0,8 dBTP) |
| EQ corretiva | cortava ≥1,7 dB assim que detetava um problema | proporcional ao excesso: 0,6 dB → máx. 3 dB |
| Anti-masking | até 5 dB de corte dinâmico | 1–3,5 dB, proporcional à sobreposição |

## Medições finais (sessão demo, Kizomba, estilo Punchy)

| Medida | Valor | Ferramenta |
|---|---|---|
| Loudness integrado | −9,6 LUFS (alvo −9,6) | MIXMIND e ffmpeg ebur128 |
| True peak | −1,2 dBTP (ceiling −1,0) | ffmpeg e MIXMIND (FIR 4×) |
| PLR | 7,8 dB | MIXMIND |
| LRA | 2,3 LU | ffmpeg |
| Correlação mínima | +0,94 | MIXMIND |
| Graves < 120 Hz em mono | 100 % | MIXMIND |
| QC | 10/10 OK | MIXMIND |

## Como repetir os testes
Os testes usados estão descritos acima (impulso para latência, ruído rosa para resposta em frequência, seno de 60 Hz para THD, música real para calibração). O motor é determinístico: o mesmo projeto renderizado duas vezes dá o mesmo ficheiro.

## v1.2 — análise do master “Midilatino Alterboy” (Club, V5)

Medido comparando o original com o master V5 enviado (função de transferência por correlação cruzada, alinhada à amostra):

| | Master V5 (versão antiga) | Master v1.2 (mesmo ficheiro, estilo Club) |
|---|---|---|
| Filtro em pente | sim — periodicidade 344,5 Hz (= 128 amostras, o atraso do WaveShaper 2×), autocorrelação 0,70 | não — 0,09 (ruído de medição) |
| Pior vale | −14,4 dB (500 Hz −9,7 dB, 1,6 kHz −3,7 dB…) | −4,9 dB (variação normal de processamento não-linear) |
| Desvio tonal do centro (M) | −9 a +3 dB | ±1 dB |
| Loudness / true peak | −8,1 LUFS / +0,6 dBTP (overs no MP3) | −8,1 LUFS / −1,0 dBTP |

Novidades da v1.2: a IA reconhece mixes que já chegam masterizadas (aqui: −9,1 LUFS, true peak +1,0 dBTP, PLR 8,9 dB) e intervém o mínimo (EQ a 35 %, compressão/saturação a metade); medidores do mixer com tamanho fixo (em ecrãs Retina/zoom o canvas crescia em loop e escondia os faders); Solo/Mute em todas as vistas com stems (o solo é só de escuta — os renders ignoram-no); cache-busting dos scripts (`?v=1.2`) para o GitHub Pages servir sempre a versão nova.

## v1.3 — Arranjo e Análise (validação)

| Teste | Resultado |
|---|---|
| Mute por secção no render offline (voz calada no Refrão 1) | −74 dB dentro da secção vs −27 dB antes (silêncio digital + fades de 12 ms) |
| Mover a fronteira Intro/Verso +2 compassos | secções e automação (send de reverb da voz, filtro do pad, largura do master) recalculadas; Ctrl+Z repõe |
| Medição “Depois” (demo, 15 stems, 2:24) | 22–26 s em Chromium sem GPU (mais rápido que o render do premaster); blocos de 8–30 s com 1 s de pré-roll, memória limitada a ~300 canal·s |
| EQ dinâmico Piano −2,6 dB @ 1 kHz | medido −3,3 dB na banda de 1 kHz quando a guitarra toca (com o EQ fixo vizinho); o masking cai só 63 → 61 %: a correção da IA é deliberadamente suave. Com −6 dB: 63 → 52 % |
| Polaridade invertida (sinal sintético) | detetada (r = −1,00); depois de inverter r = +1,00 |
| Camadas de tarola desalinhadas 0,50 ms | detetado 0,50 ms → “atrasar 0,5 ms”; r −0,03 → alinhado |
| Baixo 1 ms atrasado face ao kick (55 Hz) | lag medido 0,98 ms, r 0,94 → classificado “em fase” (20° a 55 Hz não justifica correção) |

## v1.4 — Automação e estilos no master (validação)

| Teste | Resultado |
|---|---|
| Passa-alta automatizado no Pad (645 Hz entre 50–70 s) | energia < 150 Hz: −52,9 dB fora do troço → −75,2 dB dentro |
| Fade-out do master desenhado com a ferramenta Linha (últimos 12 s, 0 → −60 dB) | RMS −9,3 → −19,1 → −39,8 → −61,8 → −87,7 dB; loudness do master −9,67 LUFS para alvo −9,6 (o fade entra depois de acertar o loudness, não empurra o ganho) |
| Forma seno no pan da guitarra (20–40 s, 1 compasso) | 129 pontos, −89…+89, início/fim encaixados na batida |
| Borracha a meio de um segmento (58–62 s) | o segmento fica dividido em dois (50–58 s e 62–70 s); antes, desenhar por cima apagava o segmento inteiro |
| Estilo musical Semba no master | caráter Warm, alvo −10 LUFS, master −9,9 LUFS |
| Excertos do master com automação | a automação do master passa a bater certo no tempo durante a procura do ganho (antes começava sempre em 0 s) |

## v1.5 — Mais destinos de automação e automação aprendida por estilo (validação)

| Teste | Resultado |
|---|---|
| Ganho de banda de EQ (Piano, 2,5 kHz, +12 dB entre 40–60 s) | +9,5 dB medidos na banda dentro do troço (−0,9 dB sem a lane, variação do arranjo) |
| Threshold do compressor (voz, −15 dB entre 40–60 s) | −6,8 dB de nível no troço (mais compressão), 0,00 dB fora |
| Tamanho do reverb Plate (cauda 0,25–1,2 s após uma frase) | 50 % = −60,1 dB (idêntico a sem lane) · 100 % −56,6 dB · 0 % −61,2 dB |
| Treino com stems pós-fader (demo com Pad +3 dB e Hi-Hat +2 dB nos refrões) | aprendido: Pad +3,0 dB, voz vs instrumental +2,8 dB, mix +1,1 LU no refrão; a IA só automatiza a diferença face ao arranjo da sessão (Pad +1,8 dB com confiança 74 %) |
| Dinâmica das secções num master único | frases de 4 compassos por energia → refrão/verso/partes baixas (largura ×1,31 no refrão da demo) |
| Material mono (largura indefinida) | rácio de largura ignorado (não força a automação de largura) |

## v1.6 — Proteção do trabalho, entrega, som, score ancorado, velocidade e modelo do engenheiro (validação)

### 1. Projeto, versões e testes
| Teste | Resultado |
|---|---|
| Exportar `.mixmind` da demo e reabrir | versões, mutes por secção e automação preservados (teste e2e) · 127 MB com os stems sintetizados em FLAC 24 (439 MB em WAV) |
| Recuperação depois de fechar o separador sem guardar | a app propõe reabrir a última sessão |
| Bateria de testes | 23 testes de DSP/formatos (Node) · 10 de ponta a ponta (Chromium) · 4 do backend contra um Supabase falso — todos a passar; correm a cada push |

### 2. Entrega
| Teste | Resultado |
|---|---|
| True peak — seno de 19 kHz a 44,1 kHz, fase arbitrária | exato a ±0,06 dB (o 4× subestimava até 0,5 dB); referência 64× concorda a ~0,02 dB; 3 min estéreo em ~2 s |
| Pré-escuta de codecs (demo, master a −1,0 dBTP) | MP3 320: −0,15 dBTP · MP3 128: +0,76 dBTP com 338 overs · Opus: −0,93 dBTP → ceiling seguro sugerido |
| Metadados WAV (ISRC, título, artista…) | lidos corretamente pelo `ffprobe` |
| DDP 2.0 | lido sem erros por uma ferramenta independente (DDP_master `read_ddp`); `md5sum -c` OK; IMAGE.DAT idêntico bit a bit ao WAV do CUE; pré-gap de 2 s em silêncio |

### 3. Som
| Teste | Resultado |
|---|---|
| EQ “matched” vs RBJ perto de Nyquist (44,1 kHz) | high shelf 14 kHz: erro máx. 0,21 dB (RBJ 0,68 dB) · peaking 12 kHz: 0,30 dB (RBJ 1,40 dB) |
| EQ de fase linear (FIR 8192/16384) | FIR simétrico centrado em N/2, magnitude ±0,2 dB do pedido (teste automático) |
| **Alinhamento do master** (impulso pela cadeia completa) | antes: o master saía **596 amostras (13,5 ms) atrasado** face à pré-master — o look-ahead do limiter e o oversampling da saturação/clipper não eram compensados. Agora a latência total (FIR N/2 + limiter L+3 + 23 por saturação/clipper) é recortada nos renders e compensada na monitorização: **≤ 1 amostra** em fase mínima e linear |
| EQ dinâmico em tempo real (sidechain) | o corte segue o nível do stem protagonista ao vivo (antes: só automação pré-calculada) |
| Correções de masking iterativas | cortes ~6 dB; sobreposição prevista 0,43 → medida 0,40 depois do render |

### 4. Score ancorado em referências externas
| Teste | Resultado |
|---|---|
| Demo com faixa de referência | dinâmica, largura e tonalidade medidas face à referência; balanço face à norma por papel (sem stems treinados); masking “previsto” → “medido” depois de medir |
| Score | original 67 → mistura 92 · Tonal Balance 85 com os desvios indicados (28–177 Hz −5,3 dB · 1,1–2,8 kHz +2,0 dB face à referência) |
| Balanço medido depois do processamento | identifica Kick +5,3 dB e Snare +3,7 dB acima da norma (o compressor/saturação somam nível que o fader não mostra) |

### 5. Velocidade (Chromium sem GPU, 2 núcleos)
| Medida | Antes | Depois |
|---|---|---|
| STFT (3 min) · true peak (3 min estéreo) | 2,6 s · 6,5 s | 0,85 s (3,1×) · 2,2 s (2,9×) — WebAssembly, iguais ao JavaScript a 10⁻⁶ dB |
| Loudness BS.1770 | — | o WebAssembly ficou **mais lento** (cópia + filtro recursivo): mantém-se em JavaScript |
| Importar + analisar a demo (15 stems) | 37,7 s | 23,9 s |
| Render da pré-master com nada alterado · com 1 stem alterado | 64,6 s | 33,6 s · 36,4 s (cache por stem; igual ao render completo a −98 dB) |
| Medição “Depois” com 1 stem alterado | 35,6 s | 4,4 s (só o stem que mudou é medido) |
| Render paralelo por blocos (2–4 contextos) | testado | sem ganho neste motor (os renders não correm em paralelo) — descartado |

### 6. Modelo do engenheiro e backend de clientes
| Teste | Resultado |
|---|---|
| Arquivo sintético com padrão (piano +4 dB face à regra, agudos +5 dB na voz) | balanço em sessões não vistas ±1,5 dB vs ±3,1 dB da regra; piano aprendido +3,9 dB; na demo o piano passa de −8,0 para −6,4 dB (peso 40 % com 4 sessões); voz de apoio inalterada (família sem exemplos = peso 0) |
| Arquivo sem padrão (ruído) | peso do modelo ≈ 0 — não estraga as regras |
| Portal → aprovação → biblioteca (Supabase falso com as regras RLS) | envio pendente; anon não lê; admin aprova → análise local → medidas publicadas → áudio apagado; um browser limpo recebe a biblioteca ao abrir a app; sem chaves, tudo local |

## v1.7 — Editor de voz nota a nota (validação)

Voz sintética com pitch e formantes conhecidos (vogal “a”: F1 700 Hz, F2 1220 Hz, F3 2600 Hz), notas a 5730, 6000 e 6400 cents (MIDI×100, esta com vibrato ±60 cents a 5,5 Hz) e uma sibilante. Testes em `tests/tune.test.mjs`.

| Teste | Resultado |
|---|---|
| Deteção de pitch: WebAssembly vs JavaScript | diferença < 1 cent; mesma decisão vozeado/não vozeado (≤ 2 tramas) |
| Centro das notas detetado | ±8 cents nas três notas; sibilante classificada como evento sem pitch; vibrato medido |
| Tonalidade a partir de uma melodia | Lá menor reconhecido (perfis de Krumhansl) |
| Sem edições | não há render (a voz original toca) |
| Editar uma nota | fora da zona editada, saída **idêntica bit a bit** ao original (mono e estéreo) |
| Subir 1 meio-tom · descer 3 meios-tons | medido +100 / −300 cents (±8) · nível ±1 / ±1,5 dB |
| Pitch Centre 100 % numa nota a +30 cents | vai ao Lá exato (±6 cents) |
| Formantes ao subir 4 meios-tons | harmónicos seguem o envelope original (erro 1,4 dB) e não o deslocado (7,4 dB): formantes preservados |
| Ferramenta de formantes +300 cents (sem mudar a nota) | envelope deslocado ×1,19 (erro 2,0 dB vs 6,1 dB face ao original) |
| Vibrato original a 0 % | desvio que sobra < 12 cents (tinha ±60) |
| Mover uma nota +100 ms | ataque 100 ms depois (±12 ms); duração do ficheiro igual |
| Ganho −6 dB · sibilantes −6 dB | −6,0 ±0,3 dB · −6 ±0,5 dB |
| Harmonia 3ª acima em Lá menor | Lá → Dó, Dó → Mi (±10 cents) |
| Qualidade do PSOLA (relação harmónicos/ruído, nota sustentada; original 54,5 dB) | −5 st 40,0 · −2 st 41,7 · −1 st 43,3 · +1 st 44,9 · +2 st 43,6 · +5 st 46,3 dB — artefactos ~40 dB abaixo dos harmónicos. A interpolação entre grãos vizinhos e as marcas sub-amostra valeram +3 a +6 dB |
| Velocidade (Chromium, demo 2:24) | análise 2,0 s · render depois de editar uma nota 0,2–0,4 s (só a zona editada) |
| Integração | a nota editada muda o render da pré-master (a voz entra antes do mixer); Ctrl+Z repõe a voz original; o monitor “Original” continua cru |
