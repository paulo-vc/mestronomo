// Integração: soundboard, ambiente, cenas, pacotes, backup e para onde o bot manda mensagens.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, tempDir, makeWav } = require('./helpers');

const { Mixer } = load('mixer');

test('soundboard: variações viram um botão, "d20" fica inteiro e pacotes viram abas', (t) => {
  const { Soundboard } = load('soundboard');
  const dir = tempDir(t);
  for (const f of ['01 porta.wav', 'd20.wav', 'Combate/espada 1.wav', 'Combate/espada (2).wav', 'Combate/escudo.wav', 'Medieval/Magia/raio.wav']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), '');
  }
  const sb = new Soundboard(new Mixer(), dir);
  const st = sb.state();
  assert.deepEqual(st.categorias, ['Geral', 'Combate', 'Medieval › Magia']);
  assert.equal(sb.find('Combate/espada').arquivos.length, 2);
  assert.equal(sb.find('d20').id, 'd20');
  assert.equal(sb.find('ESCUDO').id, 'Combate/escudo');
  assert.equal(sb.find('Medieval/Magia/raio').categoria, 'Medieval › Magia');
  assert.equal(sb.find('1').id, 'porta');
});

test('ambiente: subpastas listadas e caminhos fora da pasta recusados', (t) => {
  const { Ambience } = load('ambience');
  const dir = tempDir(t);
  makeWav(path.join(dir, 'chuva.wav'), 0.2);
  makeWav(path.join(dir, 'Medieval', 'fogo.wav'), 0.2);
  makeWav(path.join(dir, '..', path.basename(dir) + '-fora.wav'), 0.2);
  t.after(() => fs.rmSync(path.join(dir, '..', path.basename(dir) + '-fora.wav'), { force: true }));
  const mixer = new Mixer();
  const a = new Ambience(mixer, dir);
  assert.deepEqual(a.files(), ['chuva.wav', 'Medieval/fogo.wav']);
  a.toggle(`../${path.basename(dir)}-fora.wav`, true, 0);
  assert.equal(a.state().camadas.length, 0, 'não sai da pasta de ambientes');
  a.toggle('Medieval/fogo.wav', true, 0);
  assert.deepEqual(a.state().camadas.map((c) => c.arquivo), ['Medieval/fogo.wav']);
  a.stopAll(0);
});

test('cenas: salvam e restauram ambiente e filtros; cenas de pacote saem juntas', (t) => {
  const { Ambience } = load('ambience');
  const { YouTubePlayer } = load('youtube');
  const { SceneManager } = load('scenes');
  const dir = tempDir(t);
  makeWav(path.join(dir, 'caverna.wav'), 0.2);
  const mixer = new Mixer();
  const amb = new Ambience(mixer, dir);
  const filtros = { abafado: false, caverna: true, eco: false };
  const s = new SceneManager(amb, new YouTubePlayer(mixer), [], 0, { get: () => filtros, set: (f) => Object.assign(filtros, f) });
  amb.toggle('caverna.wav', true, 0);
  s.saveCurrent('Masmorra', 'manter');
  amb.stopAll(0);
  filtros.caverna = false;
  assert.equal(s.activate('masmorra'), true);
  assert.deepEqual(amb.state().camadas.map((c) => c.arquivo), ['caverna.wav']);
  assert.equal(filtros.caverna, true);
  assert.equal(s.activate('Inexistente'), false);
  s.addFromPack([{ nome: 'Taverna', pacote: 'medieval', camadas: [], ocasionais: [], musica: { modo: 'manter' } }]);
  s.removePack('medieval');
  assert.deepEqual(s.state().cenas.map((c) => c.nome), ['Masmorra']);
  amb.stopAll(0);
});

test('pacotes: os embutidos instalam e removem sem sobras', (t) => {
  const { Packs } = load('packs');
  const dir = tempDir(t);
  const packs = new Packs(path.join(__dirname, '..', 'pacotes'), path.join(dir, 'sons'), path.join(dir, 'ambientes'));
  const lista = packs.list();
  assert.deepEqual(lista.map((p) => p.id).sort(), ['medieval', 'moderno']);
  for (const p of lista) assert.ok(p.efeitos > 10 && p.ambientes > 4 && !p.instalado);
  const cenas = packs.install('medieval');
  assert.ok(packs.list().find((p) => p.id === 'medieval').instalado);
  assert.ok(fs.existsSync(path.join(dir, 'sons', 'Medieval', 'CREDITOS.txt')));
  // Toda cena aponta para ambientes que existem de verdade.
  for (const c of cenas) {
    for (const camada of c.camadas) assert.ok(fs.existsSync(path.join(dir, 'ambientes', camada.arquivo)), camada.arquivo);
    for (const o of c.ocasionais) for (const a of o.arquivos) assert.ok(fs.existsSync(path.join(dir, 'ambientes', a)), a);
  }
  packs.remove('medieval');
  assert.equal(fs.existsSync(path.join(dir, 'sons', 'Medieval')), false);
  assert.equal(fs.existsSync(path.join(dir, 'ambientes', 'Medieval')), false);
});

test('backup: leva configuração e arquivos com acento, mantém o fone deste PC', { skip: process.platform !== 'win32' && 'usa o tar.exe do Windows' }, async (t) => {
  const { exportBackup, importBackup } = load('backup');
  const dir = tempDir(t);
  const pc1 = path.join(dir, 'pc1');
  const pc2 = path.join(dir, 'pc2');
  fs.mkdirSync(path.join(pc1, 'data', 'sons', 'Ação'), { recursive: true });
  fs.writeFileSync(path.join(pc1, 'data', 'sons', 'Ação', 'trovão 1.wav'), 'som');
  fs.writeFileSync(path.join(pc1, 'config.json'), JSON.stringify({ cenas: [{ nome: 'Taverna' }], monitorDevice: 'fone-pc1' }));
  fs.mkdirSync(path.join(pc2, 'data'), { recursive: true });
  fs.writeFileSync(path.join(pc2, 'config.json'), JSON.stringify({ monitorDevice: 'fone-pc2' }));
  const zip = path.join(dir, 'backup.zip');
  await exportBackup(zip, { dataDir: path.join(pc1, 'data'), configFile: path.join(pc1, 'config.json') }, true);
  await importBackup(zip, { dataDir: path.join(pc2, 'data'), configFile: path.join(pc2, 'config.json') });
  const cfg = JSON.parse(fs.readFileSync(path.join(pc2, 'config.json'), 'utf8'));
  assert.equal(cfg.cenas[0].nome, 'Taverna');
  assert.equal(cfg.monitorDevice, 'fone-pc2');
  assert.ok(fs.existsSync(path.join(pc2, 'data', 'sons', 'Ação', 'trovão 1.wav')));
  await assert.rejects(importBackup(path.join(pc1, 'config.json'), { dataDir: dir, configFile: path.join(dir, 'x.json') }), /não é um backup/);
});

test('bot: mensagens só no servidor da mesa', async () => {
  const { DiscordBot } = load('discord');
  const enviados = [];
  const canal = (id, guildId) => ({
    id,
    guildId,
    isSendable: () => true,
    send: async (msg) => (enviados.push(`${guildId}:${msg.content ?? 'embed'}`), { channelId: id, edit: async () => {} }),
  });
  const canais = { a: canal('a', 'A'), b: canal('b', 'B') };
  const bot = new DiscordBot(new Mixer(), 'token-falso', 'mestre', { resumo: () => ({ titulo: 'R', linhas: [] }) });
  const client = bot['client'];
  client.isReady = () => true;
  client.channels.fetch = async (id) => canais[id] ?? null;
  const servidores = (mestreNaCallDe) => {
    client.guilds.cache.clear();
    for (const id of ['A', 'B']) {
      const voz = new Map(mestreNaCallDe === id ? [['mestre', { channel: { guild: { id } } }]] : []);
      client.guilds.cache.set(id, { id, name: `Servidor ${id}`, voiceStates: { cache: voz } });
    }
  };

  // O canal único antigo era do servidor A.
  bot.legacyTextChannelId = 'a';
  servidores();
  await bot['migrateLegacyChannel']();
  assert.deepEqual(bot.textChannels, { A: 'a' });

  // Bot fora de call (era o bug): automáticas não saem; manuais avisam.
  await bot.sendMessage('turno', true);
  await assert.rejects(bot.sendMessage('tabela'), /Chame o bot para uma call/);
  assert.deepEqual(enviados, []);

  // Bot na call do B sem /canal lá: nada vai para o A.
  bot['guildId'] = 'B';
  await bot.sendMessage('turno', true);
  await assert.rejects(bot.sendMessage('tabela'), /Use \/canal no canal de texto de Servidor B/);
  assert.deepEqual(enviados, []);

  bot.textChannels.B = 'b';
  await bot.sendMessage('turno', true);
  await bot.sendMessage('tabela');
  assert.deepEqual(enviados.splice(0), ['B:turno', 'B:tabela']);

  // Bot fora de call, mestre na call do A: só os envios manuais saem, no A.
  bot['guildId'] = undefined;
  servidores('A');
  await bot.sendMessage('turno', true);
  await bot.sendMessage('tabela');
  assert.deepEqual(enviados.splice(0), ['A:tabela']);
  await bot.destroy();
});
