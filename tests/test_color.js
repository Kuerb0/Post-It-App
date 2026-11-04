// electron tests/test_color.js  ·  debe terminar en «TEST OK» (necesita Electron: el de la instalación o `npx electron`)
// Abre note.html de verdad con un api de mentira: comprueba que están todos los iconos de la barra y el color del texto
// (aplicarlo a lo seleccionado, que se guarde en la nota y que «Automático» lo quite). Con CAPTURA=<fichero.png> guarda una imagen de la barra.
const { app, BrowserWindow } = require('electron'), assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'postit-test-')));

const preload = path.join(app.getPath('userData'), 'preload.js');
fs.writeFileSync(preload, `const {contextBridge}=require('electron');
const nota={id:'t1',color:'#ffd83b',html:'<div>hola mundo</div><div>otra linea</div>'};
const noop=()=>{};
contextBridge.exposeInMainWorld('api',{
  get:async()=>nota,save:(id,h)=>{window.__guardado=h},color:noop,z:async()=>0,glass:async()=>0,cols:noop,add:noop,del:noop,close:noop,min:noop,max:noop,onMax:noop,
  cal:async()=>false,limpia:async()=>false,agenda:async()=>[],refrescar:async()=>{},estilo:async()=>({fs:15,lh:1.35}),setEstilo:noop,onEstilo:noop,
  icsGet:async()=>({}),icsProbar:async()=>({}),icsGuardar:async()=>true,hechoCal:noop,
  lanz:noop,onLanz:noop,onSet:noop,onAgenda:noop});
contextBridge.exposeInMainWorld('__t',{guardado:()=>window.__guardado});`);

app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ show: true, width: 760, height: 420, webPreferences: { preload } });
    w.loadFile(path.join(__dirname, '..', 'note.html'), { query: { id: 't1' } });
    await new Promise(ok => w.webContents.once('did-finish-load', () => setTimeout(ok, 800)));
    const js = c => w.webContents.executeJavaScript(c);

    // --- todos los iconos que usa la barra existen (faltaban «tabla de eventos» y «tamaño de letra»)
    const faltan = await js(`[...new Set([...document.querySelectorAll('use')].map(u=>u.getAttribute('href')))].filter(h=>!document.querySelector(h))`);
    assert.deepStrictEqual(faltan, [], 'iconos sin definir: ' + faltan);
    assert.ok(await js(`['i-table','i-textsize','i-fcolor'].every(i=>document.getElementById(i))`));
    // y se dibujan: el botón de la tabla y el del tamaño de letra tienen un dibujo con trazo visible
    assert.ok(await js(`['[data-c=table] svg','#szb svg','[data-c=color] svg'].every(s=>{const r=document.querySelector(s).getBoundingClientRect();return r.width>=12&&r.height>=12})`));

    // --- color del texto: se selecciona «hola» y se pone en rojo
    await js(`(()=>{ed.focus();const t=ed.firstElementChild.firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,4);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
    await js(`fcb.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);   // el botón de la barra abre el panel
    assert.strictEqual(await js(`fcp.style.display`), 'flex', 'el botón abre el panel de colores');
    assert.strictEqual(await js(`fcs.children.length`), 10);
    await js(`fcs.querySelector('[data-v="#d93025"]').click()`);
    assert.strictEqual(await js(`fcp.style.display`), 'none', 'el panel se cierra al elegir');
    const html = await js(`ed.innerHTML`);
    assert.ok(/<span style="color: rgb\(217, 48, 37\);">hola<\/span> mundo/.test(html), 'solo lo seleccionado cambia de color: ' + html);
    assert.ok(!/<font/.test(html), 'sin etiquetas <font>');
    assert.strictEqual(await js(`getComputedStyle(ed.firstElementChild.querySelector('span')).color`), 'rgb(217, 48, 37)');
    await new Promise(r => setTimeout(r, 900));      // el guardado va con un respiro de 400 ms
    assert.ok(/color: rgb\(217, 48, 37\)/.test(await js('__t.guardado()')), 'el color se guarda en la nota');

    // --- «Automático» lo quita: el texto vuelve al color de la nota
    await js(`(()=>{const t=ed.querySelector('span').firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,4);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
    await js(`fca.click()`);
    const base = await js(`getComputedStyle(ed.lastElementChild).color`);
    assert.strictEqual(await js(`getComputedStyle(ed.firstElementChild.firstElementChild||ed.firstElementChild).color`), base, 'Automático vuelve al color de la nota');

    // --- un color a elegir (el del selector nativo) y escribir con color sin selección
    await js(`(()=>{const t=ed.lastElementChild.firstChild,r=document.createRange();r.setStart(t,0);r.setEnd(t,5);const s=getSelection();s.removeAllRanges();s.addRange(r)})()`);
    await js(`fcc.value='#1a73e8';fcc.dispatchEvent(new Event('change',{bubbles:true}))`);
    assert.ok(/color: rgb\(26, 115, 232\);">otra /.test(await js(`ed.innerHTML`)), 'el color elegido se aplica a la selección');

    if (process.env.CAPTURA) {
      await js(`fcp.style.display='flex';szb.click()`);
      await new Promise(r => setTimeout(r, 300));
      fs.writeFileSync(process.env.CAPTURA, (await w.webContents.capturePage()).toPNG());
    }
    console.log('TEST OK');
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
