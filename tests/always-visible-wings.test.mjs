import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('wing section exists independently and is never hidden',()=>{
 assert.match(html,/<section id="wingSection"[^>]*>/);
 assert.match(html,/<div id="wingTools" class="group">/);
 assert.doesNotMatch(html,/<div id="wingTools"[^>]*hidden/);
 assert.doesNotMatch(js, /\$\('wingTools'\)\.hidden=/);
});
test('25 and 30 degree presets appear even without imported wings',()=>{
 for(const id of ['fold25','fold30','wingAxis','wingDirection','wingStatus','wingTarget','makeWings']){
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 }
 assert.match(js,/renderWingPanel\(\)/);
 assert.match(js,/\$\('fold25'\)/.source ? /\['fold25',25\]/ : /\['fold25',25\]/);
});
test('wing selector and type conversion have working event handlers',()=>{
 assert.match(js,/\$\('wingTarget'\)\.addEventListener\('change'/);
 assert.match(js,/\$\('makeWings'\)\.addEventListener\('click'/);
 assert.match(js,/p\.config\.type='wings'/);
 assert.match(js,/movePartToBack\(p\)/);
 assert.match(js,/p\.config\.anchor='back'/);
});
test('oversize wing geometry shows diagnostic instead of silently hiding controls',()=>{
 assert.match(js,/MAX_WING_VERTICES/);
 assert.match(js,/p\.wingProblem/);
 assert.match(js,/\$\('wingStatus'\)\.textContent/);
 assert.match(js,/\$\(id\)\.disabled=!ready/);
});
test('selected panel and fold control remain independently available',()=>{
 const start=html.indexOf('<section id="wingSection"');
 const initialEditor=html.indexOf('<div id="partEditor"');
 const endSection=html.indexOf('<section><h2>3 ·');
 assert.ok(start>initialEditor && start<endSection);
 assert.ok(js.includes("picker.value=p?.id||''"));
});
