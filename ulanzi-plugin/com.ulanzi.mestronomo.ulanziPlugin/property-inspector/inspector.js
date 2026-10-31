// Property inspector de todas as ações: mostra só a seção da ação aberta.
const WITH_SETTINGS = ['som', 'volume', 'captura'];

let KIND = 'none';
let SETTINGS = {};
let form = null;

$UD.connect();

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');

  const kind = String($UD.uuid || '').split('.').pop();
  KIND = WITH_SETTINGS.includes(kind) ? kind : 'none';
  form.querySelectorAll('section').forEach((s) => s.classList.toggle('hidden', s.dataset.kind !== KIND));

  form.addEventListener('change', save);
  form.querySelectorAll('button.refresh').forEach((b) => b.addEventListener('click', () => requestList(b.dataset.cmd)));
  if (KIND === 'som') requestList('getSons');
  if (KIND === 'captura') requestList('getApps');
  applySettings();
});

// As configurações salvas chegam por um desses eventos, conforme o PI foi aberto.
$UD.onAdd((jsn) => jsn && jsn.param && loadSettings(jsn.param));
$UD.onParamFromApp((jsn) => jsn && jsn.param && loadSettings(jsn.param));

$UD.onSendToPropertyInspector((jsn) => {
  const { cmd, lista = [], erro } = jsn.payload || jsn.param || {};
  if (cmd !== 'getSons' && cmd !== 'getApps') return;
  form.querySelector('.uspi-item.erro').classList.toggle('hidden', !erro);
  const select = form.querySelector(cmd === 'getSons' ? 'select[name="som"]' : 'select[name="app"]');
  const opcoes = cmd === 'getSons'
    ? lista.map((f) => ({ value: f, text: f.replace(/\.[^.]+$/, '') }))
    : lista.map((a) => ({ value: a.name, text: a.name + (a.active ? '  ♪' : '') }));
  // Mantém a escolha salva mesmo que o som/app não esteja na lista agora.
  const salvo = cmd === 'getSons' ? SETTINGS.som : SETTINGS.app;
  if (salvo && !opcoes.some((o) => o.value === salvo)) opcoes.unshift({ value: salvo, text: salvo });
  select.replaceChildren(...opcoes.map((o) => new Option(o.text, o.value)));
  applySettings();
  // Primeira configuração: salva já o primeiro item, para a tecla não ficar vazia.
  if (!salvo && opcoes.length) save();
});

function requestList(cmd) {
  $UD.sendToPlugin({ cmd });
}

function loadSettings(param) {
  SETTINGS = { ...param };
  applySettings();
}

function applySettings() {
  if (!form) return;
  for (const [name, value] of Object.entries(SETTINGS)) {
    const field = form.querySelector(`[name="${name}"]`);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = value === true || value === 'on';
    else if ([...(field.options || [])].some((o) => o.value === String(value)) || field.tagName !== 'SELECT') field.value = value;
  }
}

function save() {
  const section = form.querySelector(`section[data-kind="${KIND}"]`);
  const values = {};
  section.querySelectorAll('[name]').forEach((field) => {
    values[field.name] = field.type === 'checkbox' ? field.checked : field.value;
  });
  SETTINGS = values;
  $UD.sendParamFromPlugin(SETTINGS);
}
