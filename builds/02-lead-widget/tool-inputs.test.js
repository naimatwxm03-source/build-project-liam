const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Форма аргументов узла calc_estimate снята с живого узла n8n, который
// РАБОТАЕТ. Два предыдущих варианта были угаданы, оба импортировались без
// единой ошибки и оба молча не работали — модели нечем было заполнить поля.
//
// Ошибка здесь не падает и не видна в UI: она видна только тем, что агент
// перестаёт называть цену. Именно поэтому она проверяется тестом, а не глазами.

const wf = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'workflow.json'), 'utf8')
);
const tool = wf.nodes.find((n) => n.name === 'calc_estimate');
const inputs = tool && tool.parameters.workflowInputs;

test('узел calc_estimate вообще есть и отдаёт аргументы', () => {
  assert.ok(tool, 'узел calc_estimate пропал из workflow.json');
  assert.ok(inputs, 'у calc_estimate нет workflowInputs');
  assert.strictEqual(inputs.mappingMode, 'defineBelow');
});

test('session_id приходит из конверта, а НЕ от модели', () => {
  // Если модель начнёт выдумывать session_id, метка расчёта ляжет в чужой
  // ключ Redis — и форма контактов откроется в чужой сессии.
  const v = inputs.value.session_id;
  assert.ok(v && v.includes("$('Normalize Web Request')"), v);
  assert.ok(!v.includes('$fromAI'), 'session_id отдан модели — это дыра в воротах формы');
});

test('модель заполняет ровно те четыре поля, которые говорит человек', () => {
  for (const f of ['configuration', 'glazing', 'floor', 'extension']) {
    assert.ok(inputs.value[f], `${f} не заполняется моделью — расчёт не состоится`);
    assert.ok(inputs.value[f].includes(`$fromAI('${f}'`), inputs.value[f]);
  }
});

test('profile_tier и address модель НЕ заполняет', () => {
  // Поймано на живом прогоне: с пустым описанием модель присылала «стандарт»
  // и «Самара», которых посетитель не говорил. Выдуманный адрес уводил расчёт
  // в ветку уточнения адреса, и цена не показывалась вообще.
  //
  // Пустое поле в n8n — это ОТСУТСТВИЕ ключа, а не пустая строка.
  for (const f of ['profile_tier', 'address']) {
    assert.ok(!(f in inputs.value), `${f} снова заполняется моделью: ${inputs.value[f]}`);
  }
});

test('schema перечисляет ВСЕ поля подworkflow, включая пустые', () => {
  // Поле, которого нет в schema, узел не покажет и не передаст.
  const expected = ['session_id', 'configuration', 'glazing', 'profile_tier',
                    'floor', 'extension', 'address'];
  assert.deepStrictEqual(inputs.schema.map((f) => f.id), expected);
  for (const f of inputs.schema) {
    assert.strictEqual(f.type, 'string');
    assert.strictEqual(f.display, true);
  }
});

test('поля инструмента совпадают с входами подworkflow', () => {
  // Разойдутся имена — аргумент молча потеряется, и расчёт вернёт ok=false
  // на вопрос, в котором человек всё назвал.
  const sub = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'estimate.workflow.json'), 'utf8')
  );
  const trigger = sub.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  const subFields = trigger.parameters.workflowInputs.values.map((v) => v.name);
  assert.deepStrictEqual(inputs.schema.map((f) => f.id), subFields);
});

test('модель, к которой всё это прицеплено, умеет вызывать функции', () => {
  // yandexgpt-lite не умеет. Решение 04. Проверка стоит здесь, потому что
  // смена модели обратно на lite ломает не узел, а весь замысел сборки —
  // и ломает молча: агент начинает пересказывать расчёт словами.
  const model = wf.nodes.find((n) => n.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi');
  const uri = model.parameters.model.value;
  assert.ok(!/yandexgpt-lite/.test(uri), `${uri} не умеет вызывать функции — см. Решение 04`);
  assert.ok(/yandexgpt-5\.1|yandexgpt-5-pro|yandexgpt\/rc/.test(uri), uri);
});

test('оба workflow ссылаются на Error Workflow', () => {
  // Настройка живёт в settings, а импорт файла перезаписывает settings целиком.
  // Выставленная руками в UI, она исчезала при каждом импорте — и сборка
  // оставалась без оповещений ровно тогда, когда в неё вносили изменения.
  // Ошибка без алерта — это ошибка, о которой узнаёт клиент, а не мы.
  for (const f of ['workflow.json', 'estimate.workflow.json']) {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    assert.ok(w.settings.errorWorkflow, `${f}: errorWorkflow не задан`);
  }
});

test('лид пишется в таблицу, а не теряется по дороге', () => {
  const save = wf.nodes.find((n) => n.name === 'Save Lead');
  assert.ok(save, 'узел Save Lead пропал');
  assert.strictEqual(save.parameters.operation, 'insert');
  // Сбой таблицы не должен отнимать у посетителя подтверждение: строку мы
  // потом восстановим из Error Workflow, а доверие — нет.
  assert.strictEqual(save.onError, 'continueRegularOutput');
});

test('отправка контактов НЕ идёт через агента', () => {
  // Человек уже нажал «Отправить» — модели тут нечего решать, а любой её
  // шаг на этом пути это лишний способ потерять телефон.
  const c = wf.connections['Contact Submission?'].main;
  assert.deepStrictEqual(c[0].map((x) => x.node), ['Check Quoted — Lead']);
  assert.deepStrictEqual(c[1].map((x) => x.node), ['Lead Agent']);
});
