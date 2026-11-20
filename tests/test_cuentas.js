// electron tests/test_cuentas.js  ·  debe terminar en «TEST OK»
// Abre note.html con un api de mentira: crea una cuenta atrás de 5 min desde el menú «/», comprueba que NO se pinta dentro de la nota, que se guarda en la nota, que sale en alarms() (para que suene con la nota cerrada) y que «Quitar» la elimina.
const { app, BrowserWindow } = require('electron'), assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'postit-test-')));

const preload = path.join(app.getPath('userData'), 'preload.js');
fs.writeFileSync(preload, `const {contextBridge}=require('electron');
const nota={id:'t1',color:'#ffd83b',html:'<div>hola mundo</div>'};
const noop=()=>{};
contextBridge.exposeInMainWorld('api',{
  get:async()=>nota,save:(id,h,al,cu)=>{window.__g={al,cu}},color:noop,z:async()=>0,glass:async()=>0,cols:noop,add:noop,del:noop,close:noop,min:noop,max:noop,onMax:noop,
  cal:async()=>false,limpia:async()=>false,agenda:async()=>[],refrescar:async()=>{},estilo:async()=>({fs:15,lh:1.35}),setEstilo:noop,onEstilo:noop,
  icsGet:async()=>({}),icsProbar:async()=>({}),icsGuardar:async()=>true,hechoCal:noop,
  lanz:noop,onLanz:noop,onSet:noop,onAgenda:noop});
contextBridge.exposeInMainWorld('__t',{guardado:()=>window.__g});`);

app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ show: true, x: -1500, y: 50, width: 760, height: 420, webPreferences: { preload } }); // pantalla de la izquierda
    w.loadFile(path.join(__dirname, '..', 'note.html'), { query: { id: 't1' } });
    await new Promise(ok => w.webContents.once('did-finish-load', () => setTimeout(ok, 800)));
    const js = c => w.webContents.executeJavaScript(c);
    const esp = ms => new Promise(r => setTimeout(r, ms));

    // --- «/» › Cuenta atrás está en el menú y abre el panel
    await js(`(()=>{ed.focus();const t=ed.firstElementChild.firstChild,r=document.createRange();r.setStart(t,t.length);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('insertText',false,' /cuen')})()`);
    assert.ok(await js(`slash.style.display=='block'&&[...slash.children].some(d=>d.dataset.k=='cnt')`), 'el menú «/» ofrece Cuenta atrás');
    await js(`slashPick('cnt')`);
    assert.strictEqual(await js(`cnp.style.display`), 'flex', 'se abre el panel');
    assert.strictEqual(await js(`ed.textContent`), 'hola mundo ', 'se quita «/cuen» del texto');

    // --- crear una de 5 min
    await js(`cnv.value=5;cnu.value=1;cnok.click()`);
    assert.strictEqual(await js(`cnp.style.display`), 'none', 'el panel se cierra al aceptar');
    assert.strictEqual(await js(`!!document.getElementById('cnt')`), false, 'ya no hay contador dentro de la nota');

    // --- se guarda en la nota y sale en alarms() (suena con la nota cerrada)
    const g = await js(`__t.guardado()`);
    assert.strictEqual(g.cu.length, 1); assert.strictEqual(g.cu[0].mins, 5);
    const falta = new Date(g.cu[0].fin) - Date.now();
    assert.ok(falta > 290e3 && falta <= 300e3, 'fin dentro de 5 min: ' + falta);
    const al = await js(`alarms()`);
    const c = al.find(a => /Cuenta atrás de 5 min/.test(a.txt));
    assert.ok(c, 'aparece en alarms(): ' + JSON.stringify(al));
    assert.ok(Math.abs(new Date(c.t) - new Date(g.cu[0].fin)) < 1000, 'con la hora del fin');

    // --- recargar desde la nota (load) y quitar con el panel
    await js(`load({id:'t1',color:'#ffd83b',html:'<div>x</div>',cuentas:[{fin:new Date(Date.now()+600e3).toISOString(),mins:10}]})`);
    assert.strictEqual(await js(`cn.length`), 1, 'load restaura las cuentas');
    await js(`openCnt()`);
    assert.strictEqual(await js(`cnl.querySelectorAll('button').length`), 1);
    await js(`cnl.querySelector('button').click()`);
    assert.strictEqual(await js(`cn.length`), 0, 'Quitar la elimina');
    assert.strictEqual(await js(`__t.guardado().cu`), undefined, 'y se guarda vacío');
    assert.ok(!(await js(`alarms()`)).some(a => /Cuenta atrás/.test(a.txt)), 'ya no está en alarms()');
    await js(`document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
    assert.strictEqual(await js(`cnp.style.display`), 'none', 'clic fuera cierra el panel');
    // --- ventana overlay (cuentas.html): formato h:mm:ss / mm:ss y rojo a 0, dado un array
    const pre2 = path.join(app.getPath('userData'), 'pre2.js');
    fs.writeFileSync(pre2, `const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('api',{onCuentas:f=>{window.__f=f}});`);
    const o = new BrowserWindow({ show: true, x: -400, y: 50, width: 220, height: 200, transparent: true, frame: false, webPreferences: { preload: pre2 } });
    o.loadFile(path.join(__dirname, '..', 'cuentas.html'));
    await new Promise(ok => o.webContents.once('did-finish-load', ok));
    const jo = c => o.webContents.executeJavaScript(c);
    const ahora = Date.now();
    await jo(`cu=${JSON.stringify([{ fin: new Date(ahora + 3700e3).toISOString(), color: '#ffd83b' }, { fin: new Date(ahora + 65e3).toISOString(), color: '#81d4fa' }, { fin: new Date(ahora - 1000).toISOString(), color: '#fff' }])};pinta()`);
    const filas = await jo(`[...l.children].map(d=>({t:d.textContent,z:d.className,c:getComputedStyle(d).color}))`);
    assert.strictEqual(filas.length, 3);
    assert.ok(/^1:01:\d\d$/.test(filas[0].t), 'con horas: ' + filas[0].t);
    assert.ok(/^0[01]:\d\d$/.test(filas[1].t), 'mm:ss: ' + filas[1].t);
    assert.strictEqual(filas[2].t, '00:00'); assert.strictEqual(filas[2].z, 'z'); assert.strictEqual(filas[2].c, 'rgb(255, 59, 48)', 'rojo a 0');
    assert.strictEqual(await jo(`getComputedStyle(document.body).backgroundColor`), 'rgba(0, 0, 0, 0)', 'sin fondo');
    o.close();
    console.log('TEST OK');
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
