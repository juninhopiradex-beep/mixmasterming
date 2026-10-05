# MixMind — Auditoria de áudio (v1.1)

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
| Loudness integrado | −9,6 LUFS (alvo −9,6) | MixMind e ffmpeg ebur128 |
| True peak | −1,2 dBTP (ceiling −1,0) | ffmpeg e MixMind (FIR 4×) |
| PLR | 7,8 dB | MixMind |
| LRA | 2,3 LU | ffmpeg |
| Correlação mínima | +0,94 | MixMind |
| Graves < 120 Hz em mono | 100 % | MixMind |
| QC | 10/10 OK | MixMind |

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
