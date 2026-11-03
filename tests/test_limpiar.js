// electron tests/test_limpiar.js  ·  debe terminar en «TEST OK» (necesita Electron: el de la instalación o `npx electron`)
// Abre note.html y lanzador.html de verdad con un api de mentira: comprueba el autoborrado de días pasados y el borrado desde el lanzador.
const { app, BrowserWindow } = require('electron'), assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'postit-test-')));

const f = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const dia = k => { const d = new Date(); d.setDate(d.getDate() + k); return f(d); };
const html = `<div>Antes de todo</div><div>${dia(-3)}</div><div>tarea vieja</div><div>${dia(-1)}</div><div>ayer</div><div>${dia(0)}</div><div>hoy</div><div>${dia(2)}</div><div>futuro</div>`;

const preload = path.join(app.getPath('userData'), 'preload.js');
fs.writeFileSync(preload, `const {contextBridge,ipcRenderer:r}=require('electron');
const nota={id:'t1',color:'#ffd83b',html:${JSON.stringify(html)},limpia:true};
window.__lanz=[];
const noop=()=>{};
contextBridge.exposeInMainWorld('api',{
  get:async()=>nota,save:(id,h)=>{window.__guardado=h},color:noop,z:async()=>0,glass:async()=>0,cols:noop,add:noop,del:noop,close:noop,min:noop,
  cal:async()=>false,limpia:async()=>false,agenda:async()=>[],refrescar:async()=>{},estilo:async()=>({fs:15,lh:1.35}),setEstilo:noop,onEstilo:noop,
  icsGet:async()=>({}),icsProbar:async()=>({}),icsGuardar:async()=>true,hechoCal:noop,
  lanz:(a,id)=>{window.__lanz.push([a,id])},onLanz:f=>{window.__alanz=f},onSet:noop,onAgenda:noop});
contextBridge.exposeInMainWorld('__t',{guardado:()=>window.__guardado,lanz:()=>window.__lanz,pintar:l=>window.__alanz(l)}); // lo que el api de mentira anota, visible desde la página`);

const abrir = (fichero, query) => {
  const w = new BrowserWindow({ show: false, webPreferences: { preload } });
  w.loadFile(path.join(__dirname, '..', fichero), query ? { query } : undefined);
  return new Promise(ok => w.webContents.once('did-finish-load', () => setTimeout(() => ok(w), 700)));
};

app.whenReady().then(async () => {
  try {
    // --- nota con «borrar los días pasados» activo: se van los dos días pasados con lo que tienen debajo; hoy, el futuro y lo anterior a la primera fecha se quedan
    const n = await abrir('note.html', { id: 't1' });
    const txt = await n.webContents.executeJavaScript(`[...document.getElementById('ed').children].map(x=>x.textContent).join('|')`);
    assert.strictEqual(txt, `Antes de todo|${dia(0)}|hoy|${dia(2)}|futuro`);
    await new Promise(r => setTimeout(r, 900)); // el guardado va con un respiro de 400 ms
    const guardado = await n.webContents.executeJavaScript('__t.guardado()');
    assert.ok(guardado && !/tarea vieja|ayer/.test(guardado) && /hoy/.test(guardado), 'se guarda sin lo borrado y con lo demás');

    // --- lanzador: cada nota lleva su botón 🗑 y el clic derecho pide borrarla
    const l = await abrir('lanzador.html');
    await l.webContents.executeJavaScript(`__t.pintar([{id:'a',color:'#ff0',html:'<div>uno</div>',open:true,start:true,main:true},{id:'b',color:'#0ff',html:'<div>dos</div>',open:false,start:false,main:false}]);0`);
    assert.strictEqual(await l.webContents.executeJavaScript(`document.querySelectorAll('button[data-a=borrar]').length`), 2);
    await l.webContents.executeJavaScript(`document.querySelector('[data-id=b] button[data-a=borrar]').click();document.querySelector('[data-id=a] .m').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    assert.deepStrictEqual(await l.webContents.executeJavaScript('__t.lanz()'), [['borrar', 'b'], ['borrar', 'a']]);
    console.log('TEST OK');
    app.exit(0);
  } catch (e) { console.error('FALLA:', e.message); app.exit(1); }
});
