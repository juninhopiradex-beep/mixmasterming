/* MIXMIND — portal público de envio (clientes). Só usa a chave anon: pode enviar, não pode ler nada. */
(function () {
  const C = window.MM.cloud, $ = (s) => document.querySelector(s);
  const AUDIO = /\.(wav|wave|aif|aiff|flac|mp3|m4a|ogg)$/i;
  let files = [];
  if (!C.on()) { $('#off').style.display = ''; return; }
  $('#f').style.display = '';
  C.styles().then((list) => { $('#sty').innerHTML = list.map((s) => `<option>${s.replace(/</g, '&lt;')}</option>`).join(''); });
  const fmtB = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
  const show = () => { $('#list').innerHTML = files.map((f, i) => `<div><span>${f.name.replace(/</g, '&lt;')}</span><span class="mono" id="fp${i}">${fmtB(f.size)}</span></div>`).join(''); if (!$('#tt').value && files.length === 1) $('#tt').value = files[0].name.replace(/\.[a-z0-9]+$/i, ''); };
  const pick = (dir) => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'audio/*,.wav,.aif,.aiff,.flac,.mp3'; if (dir) i.webkitdirectory = true; i.onchange = () => { files = Array.from(i.files).filter((f) => AUDIO.test(f.name) && f.size < 524288000); if (dir && files[0] && files[0].webkitRelativePath && !$('#tt').value) $('#tt').value = files[0].webkitRelativePath.split('/')[0]; if (dir) $('#kind').value = 'stems'; show(); }; i.click(); };
  $('#pick').onclick = () => pick(false); $('#pickDir').onclick = () => pick(true);
  const msg = (t, cl) => { $('#msg').className = 'small ' + (cl || ''); $('#msg').textContent = t; };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if (!files.length) return msg('Escolhe pelo menos um ficheiro de áudio.', 'err');
    if (!$('#rights').checked) return msg('Tens de confirmar os direitos.', 'err');
    $('#go').disabled = true; $('#pb').style.display = '';
    const id = (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
    const day = new Date().toISOString().slice(0, 10), total = files.reduce((a, f) => a + f.size, 0);
    let done = 0; const up = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i], path = `incoming/${day}/${id}/${String(i + 1).padStart(3, '0')}_${C.safeName(f.name)}`;
        msg(`A enviar ${i + 1}/${files.length}…`);
        await C.upload(f, path, (p) => { $('#pb i').style.width = ((done + p * f.size) / total) * 100 + '%'; const el = document.getElementById('fp' + i); if (el) el.textContent = Math.round(p * 100) + ' %'; });
        done += f.size; up.push({ path, name: f.name, size: f.size });
      }
      await C.submit({ client_name: $('#nm').value.trim(), client_email: $('#em').value.trim(), style: $('#sty').value, kind: $('#kind').value, title: ($('#tt').value || files[0].name).trim().slice(0, 200), files: up, note: $('#nt').value.trim() || null, rights_ok: true });
      msg('Recebido! Obrigado — o envio fica pendente até ser revisto.', 'ok');
      files = []; show(); $('#tt').value = ''; $('#nt').value = ''; $('#rights').checked = false;
    } catch (er) { msg(er.message, 'err'); }
    $('#go').disabled = false;
  };
})();
