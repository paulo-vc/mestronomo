// Lógica pura: dados, tracker de combate, pedidos, registro da sessão, tabelas, roteiro e versões.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, tempDir, sequencia } = require('./helpers');

const { roll, formatRoll, rollCommand, formatCommand } = load('dice');
/** Valor de random() que faz um d20 sair `face`. */
const d20 = (...faces) => sequencia(faces.map((f) => (f - 1) / 20 + 0.001));
/** Idem para um dado de `lados` lados. */
const dN = (lados, ...faces) => sequencia(faces.map((f) => (f - 1) / lados + 0.001));

test('dados: vantagem mantém o maior e soma o modificador', () => {
  const r = roll('2d20kh1+5', d20(3, 17));
  assert.equal(r.total, 22);
  assert.equal(formatRoll(r), '`2d20kh1+5` → [~~3~~, **17**] + 5 = **22**');
});

test('dados: "desvantagem" não vira "des" + vantagem', () => {
  assert.equal(roll('desvantagem', d20(3, 17)).total, 3);
  assert.equal(roll('vantagem+2', d20(3, 17)).total, 19);
});

test('dados: 20 e 1 naturais', () => {
  assert.equal(roll('1d20', d20(20)).natural, 'critico');
  assert.equal(roll('d20+4', d20(1)).natural, 'falha');
  assert.equal(roll('1d20+2d6', d20(20, 1, 1)).natural, undefined);
});

test('dados: expressões inválidas dão erro claro', () => {
  for (const [entrada, trecho] of [
    ['2x6', 'Não entendi'],
    ['1000d6', 'de 1 a 100'],
    ['d1', 'de 2 a 1000'],
    ['', 'vazia'],
  ]) {
    assert.throws(() => roll(entrada), (e) => e.message.includes(trecho), entrada);
  }
});

test('dados: 3#d20+5 rola três vezes, separado', () => {
  const c = rollCommand('3#d20+5', d20(10, 20, 1));
  assert.deepEqual(c.rolagens.map((r) => r.total), [15, 25, 6]);
  assert.deepEqual(c.rolagens.map((r) => r.natural), [undefined, 'critico', 'falha']);
  assert.equal(formatCommand(c).split('\n')[0], '`3#d20+5`');
  assert.match(formatCommand(c), /^2\. \[\*\*20\*\*\] \+ 5 = \*\*25\*\*  ✨/m);
});

test('dados: descartar (dl/dh), explodir (!) e rolar de novo (r)', () => {
  const dl = roll('4d6dl1', dN(6, 6, 1, 6, 6));
  assert.equal(dl.total, 18);
  assert.equal(dl.detalhe, '[**6**, ~~1~~, **6**, **6**]');
  assert.equal(roll('4d6dh1', dN(6, 6, 1, 5, 4)).total, 10);
  // 6 explode → 6 explode → 2; os outros dois saem 3 e 4.
  const ex = roll('3d6!', dN(6, 6, 6, 2, 3, 4));
  assert.equal(ex.total, 21);
  assert.equal(ex.grupos[0].dados.length, 5);
  // 2 e 1 (≤ 2) rolam de novo, uma vez só.
  const r = roll('2d6r2', dN(6, 2, 5, 1, 1));
  assert.equal(r.detalhe, '[~~2~~, **5**, ~~1~~, **1**]');
  assert.equal(r.total, 6);
});

test('dados: parênteses, * e / (arredonda para baixo)', () => {
  const r = roll('(2d6+3)*2', dN(6, 3, 1));
  assert.equal(r.total, 14);
  assert.equal(r.detalhe, '([**3**, **1**] + 3) × 2');
  assert.equal(roll('3d6/2', dN(6, 1, 2, 4)).total, 3);
  assert.equal(roll('-2+10').total, 8);
});

test('dados: >= mostra sucesso/falha e conta sucessos com #', () => {
  const r = roll('d20+5>=15', d20(10));
  assert.deepEqual(r.teste, { comparador: '>=', alvo: 15, sucesso: true });
  assert.match(formatRoll(r), /= \*\*15\*\* ≥ 15 ✅ sucesso$/);
  const c = rollCommand('3#d20+3 > 12 teste de força', d20(15, 2, 10));
  assert.equal(c.rotulo, 'teste de força');
  assert.deepEqual(c.rolagens.map((x) => x.teste.sucesso), [true, false, true]);
  assert.match(formatCommand(c), /\*\*2\*\* de 3 sucessos$/);
});

test('dados: rótulo depois da expressão, sem colar palavras soltas', () => {
  const c = rollCommand('d20 + 5 iniciativa do goblin', d20(7));
  assert.equal(c.expressao, 'd20+5');
  assert.equal(c.rotulo, 'iniciativa do goblin');
  assert.equal(formatCommand(c), '`d20+5` — *iniciativa do goblin* → [**7**] + 5 = **12**');
  // "d20 3 vezes" não vira d203.
  const v = rollCommand('d20 3 vezes', d20(4));
  assert.equal(v.expressao, 'd20');
  assert.equal(v.rotulo, '3 vezes');
  assert.equal(rollCommand('vantagem + 2 ataque', d20(3, 17)).rolagens[0].total, 19);
});

test('dados: limites e erros claros dos recursos novos', () => {
  for (const [entrada, trecho] of [
    ['21#d20', 'de 1 a 20 rolagens'],
    ['2d6r6', 'rolaria de novo todos'],
    ['(d20+2', 'parêntese'],
    ['d20/0', 'zero'],
    ['oi tudo bem', 'Não entendi'],
  ]) {
    assert.throws(() => rollCommand(entrada), (e) => e.message.includes(trecho), entrada);
  }
  // Muitos dados: a mensagem não passa do limite do Discord.
  assert.ok(formatCommand(rollCommand('20#100d6')).length <= 2000);
});

test('combate: ordena, avança rodadas e mantém o turno ao entrar alguém', () => {
  const { Combat } = load('combat');
  const c = new Combat();
  const turnos = [];
  c.on('turno', (x, r) => turnos.push(`${r}:${x.nome}`));
  c.add({ nome: 'Aria', iniciativa: 15, hp: 30, jogador: true });
  c.add({ nome: 'Orc', iniciativa: 15, hp: 15 });
  c.add({ nome: 'Goblin', iniciativa: 19, hp: 7 });
  assert.deepEqual(c.state().combatentes.map((x) => x.nome), ['Goblin', 'Aria', 'Orc'], 'empate: jogador primeiro');
  c.start();
  c.next();
  c.next();
  c.next();
  assert.deepEqual(turnos, ['1:Goblin', '1:Aria', '1:Orc', '2:Goblin']);
  c.add({ nome: 'Lobo', iniciativa: 30 });
  assert.equal(c.state().combatentes[c.state().turno].nome, 'Goblin');
});

test('combate: dano, cura e /iniciativa sem duplicar o jogador', () => {
  const { Combat } = load('combat');
  const c = new Combat();
  c.add({ nome: 'Orc', iniciativa: 9, hp: 15 });
  const orc = c.state().combatentes[0];
  c.applyHp(orc.id, '-7');
  c.applyHp(orc.id, '+3');
  assert.equal(orc.hp, 11);
  c.upsertPlayer('111', 'Aria', 17);
  c.upsertPlayer('111', 'Aria', 20);
  assert.equal(c.state().combatentes.filter((x) => x.nome === 'Aria').length, 1);
  assert.equal(c.state().combatentes[0].iniciativa, 20);
  c.applyHp(orc.id, '-50');
  assert.match(c.orderText(), /~~Orc~~/);
  assert.doesNotMatch(c.orderText(), /HP|\/15/);
});

test('pedidos: limite por jogador, aprovação e desligar', () => {
  const { Requests } = load('requests');
  const r = new Requests();
  const aprovados = [];
  r.on('aprovado', (p) => aprovados.push(p.valor));
  const lia = { id: '9', nome: 'Lia' };
  assert.equal(r.add('musica', lia, 'https://youtu.be/x').ok, true);
  r.add('som', lia, 'risada');
  r.add('som', lia, 'risada');
  assert.equal(r.add('som', lia, 'mais').ok, false);
  r.approve(r.state().pedidos[0].id);
  assert.deepEqual(aprovados, ['https://youtu.be/x']);
  r.setAccepting(false);
  assert.equal(r.add('som', { id: '8', nome: 'Kai' }, 'x').ok, false);
});

test('registro da sessão: sem repetição seguida e combate contado uma vez', () => {
  const { SessionLog } = load('sessionLog');
  const log = new SessionLog({ inicio: Date.now() - 3600000, eventos: [] });
  log.add('musica', 'Tavern Music');
  log.add('musica', 'Tavern Music');
  log.add('combate', 'Combate começou (3 combatentes)');
  log.add('combate', 'Combate terminou na rodada 4');
  assert.equal(log.state().eventos.length, 3);
  assert.match(log.summary().linhas[0], /\*\*1\*\* combate ·/);
  assert.match(log.summary().titulo, /1 h/);
});

test('tabelas: peso "3x" e rolagens [[...]] embutidas', (t) => {
  const { listTables, rollTable } = load('tables');
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'Encontros.txt'), '# comentário\n3x Nada\n[[2d4]] lobos\n');
  fs.writeFileSync(path.join(dir, 'LEIA-ME.txt'), 'ignorado');
  assert.deepEqual(listTables(dir), ['Encontros']);
  // 4 opções (3 "Nada" + lobos); 0.8 sorteia a última; os d4 saem 3 e 4.
  const r = rollTable(dir, 'Encontros', sequencia([0.8, 0.5, 0.8]));
  assert.equal(r.texto, '7 lobos');
  assert.throws(() => rollTable(dir, 'Nao existe'), /não encontrada/);
});

test('roteiro: momentos, ordem e avanço', (t) => {
  const { Scripts } = load('script');
  const s = new Scripts(undefined, tempDir(t));
  const entrou = [];
  s.on('momento', (m) => entrou.push(m.titulo));
  s.create('Sessão 12');
  s.saveMoment({ titulo: 'Taverna', cena: 'c1' });
  s.saveMoment({ titulo: 'Briga' });
  s.saveMoment({ titulo: 'Fuga' });
  const [, briga] = s.state().roteiros[0].momentos;
  s.moveMoment(briga.id, -1);
  assert.deepEqual(s.state().roteiros[0].momentos.map((m) => m.titulo), ['Briga', 'Taverna', 'Fuga']);
  s.next();
  s.next();
  s.previous();
  assert.deepEqual(entrou, ['Briga', 'Taverna', 'Briga']);
  s.goTo(99);
  assert.equal(s.current().titulo, 'Briga');
});

test('convite do bot: id tirado do token e permissões', () => {
  const { botIdFromToken, inviteUrl } = load('botSetup');
  const token = `${Buffer.from('123456789012345678').toString('base64').replace(/=+$/, '')}.AAAAAA.${'x'.repeat(38)}`;
  assert.equal(botIdFromToken(token), '123456789012345678');
  assert.equal(botIdFromToken('lixo'), undefined);
  assert.match(inviteUrl('123456789012345678'), /client_id=123456789012345678&scope=bot\+applications\.commands&permissions=3263488$/);
});

test('versões: comparação número a número', () => {
  const { isNewer } = load('version');
  assert.equal(isNewer('1.2.0', '1.1.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.3'), true);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.0.9', '1.1.0'), false);
});

test('atalhos: valida combinações, recusa repetidas e avisa quando outro programa usa', () => {
  const { DEFAULT_HOTKEYS, registerHotkeys, validateAccelerator } = load('hotkeys');
  assert.equal(validateAccelerator('Control+Alt+1'), undefined);
  assert.equal(validateAccelerator('F5'), undefined, 'teclas F podem ir sozinhas');
  assert.match(validateAccelerator('A'), /Ctrl, Alt ou Shift/);
  assert.match(validateAccelerator('Control+Alt'), /Falta a tecla principal/);

  const ocupadas = new Set(['Control+Alt+9']);
  const registradas = new Map();
  const executadas = [];
  const { falhas } = registerHotkeys(
    [...DEFAULT_HOTKEYS, { tecla: 'Control+Alt+1', acao: { tipo: 'turno' } }, { tecla: 'B', acao: { tipo: 'bot' } }],
    (acao) => executadas.push(acao.tipo),
    (tecla, fn) => !ocupadas.has(tecla) && (registradas.set(tecla, fn), true),
  );
  assert.deepEqual(
    falhas.map((f) => `${f.indice}:${f.tecla}`),
    ['8:Control+Alt+9', '10:Control+Alt+1', '11:B'],
  );
  assert.equal(registradas.size, 9, '1..8 e 0 registrados');
  registradas.get('Control+Alt+0')();
  registradas.get('Control+Alt+2')();
  assert.deepEqual(executadas, ['pararEfeitos', 'somPosicao']);
});
