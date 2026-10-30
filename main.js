const {app,BrowserWindow,Tray,Menu,ipcMain,nativeImage,dialog,screen,shell,Notification,net}=require('electron');
const S=require('./sync'),E=require('./eventos');
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');

const LOCAL=path.join(__dirname,'notes.json'); // solo la 1.x guardaba aquí; se importa una vez
let DATOS; // carpeta de las notas: la de sincronización (OneDrive) o, sin ella, la de datos de la app. Cada equipo escribe en ella su postit-<equipo>.json
const ICON=path.join(__dirname,'assets','icon.png');
// Post-it de la primera vez: lo esencial, con ejemplos que se pueden probar ahí mismo. El resto está en F1.
const BIENVENIDA=(()=>{
  const d=new Date(Date.now()+864e5),f=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][d.getDay()]+' '+String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0');
  return '<div><b>Bienvenido a Post-It 👋</b></div>'+
    '<div>Escribe <b>-</b> y un espacio para crear una tarea:</div>'+
    '<div><input type="checkbox"> probar una tarea</div>'+
    '<div><input type="checkbox"> regar las plantas @diario</div>'+
    '<div>Escribe una fecha y verás los días que faltan:</div>'+
    '<div><b>'+f+'</b></div>'+
    '<div><input type="checkbox"> 18:30 Dentista</div>'+
    '<div><b>/</b> abre un menú: alarma, tarea, carpeta…</div>'+
    '<div>📅 de la barra une la nota a tu calendario; el icono de la bandeja te deja elegir la carpeta de sincronización.</div>'+
    '<div><b>F1</b> te enseña todos los atajos · <b>Ctrl+L</b> todas tus notas.</div>';
})();
const COLORS=['#fff176','#ffab91','#a5d6a7','#81d4fa','#f48fb1','#ce93d8'];
let notes=[],borradas=[],ajustes={},colores=E.cacheVacia(),eventos=[],pos={},POS,ALM,tray,CFG,cfg={},carpeta=null,firma='',firmaS='',tExp;
const ESTADO=S.estadoNuevo();
const wins=new Map();
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const guardarSync=()=>S.escribirSync(DATOS,{notas:notes,borradas,ajustes,colores});
const save=()=>{borradas=S.marcar(ESTADO,notes);guardarSync();exportar()};
const find=id=>notes.find(n=>n.id==id);
const win=e=>BrowserWindow.fromWebContents(e.sender);

// Electron no tiene "siempre debajo": un PowerShell auxiliar llama a SetWindowPos(HWND_BOTTOM)
// con cada handle que le llega por stdin. Se cierra solo cuando muere la app (stdin se cierra).
const PS=`Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);'
while(($l=[Console]::In.ReadLine()) -ne $null){if($l -match '^\\d+$'){[N.W]::SetWindowPos([IntPtr][int64]$l,[IntPtr]1,0,0,0,0,0x13)|Out-Null}}`;
let ps;
function toBottom(w){
  if(!ps){
    ps=spawn('powershell',['-NoProfile','-EncodedCommand',Buffer.from(PS,'utf16le').toString('base64')],{stdio:['pipe','ignore','ignore'],windowsHide:true});
    ps.on('exit',()=>ps=null);ps.stdin.on('error',()=>{});
  }
  ps.stdin.write(w.getNativeWindowHandle().readBigUInt64LE()+'\n');
}
// n.glass: translucida (opacidad .65, texto incluido)
// n.z: undefined = normal · 'top' = encima de todo · 'bottom' = debajo de las demás ventanas
function apply(w,n,now=true){ // now=false: la nota está en uso, baja al perder el foco
  w.setAlwaysOnTop(n.z=='top');
  w.setOpacity(n.glass?0.65:1);
  if(n.z=='bottom'&&now)toBottom(w);
}

// Una ventana sin botón en la barra de tareas no pertenece a ningún escritorio virtual y sale en todos.
// Cada nota se queda en el escritorio donde está (pos[id].desk) y se oculta en los demás; «Mostrar todas» las trae al actual.
const VD='HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';
let ahora='',todos=''; // ids en hexadecimal: el escritorio actual y todos los que hay juntos
const hex=v=>{try{return execFileSync('reg',['query',VD,'/v',v],{encoding:'utf8',windowsHide:true}).match(/REG_BINARY\s+([0-9a-f]+)/i)[1].toLowerCase()}catch{return ''}};
const gp=()=>fs.writeFileSync(POS,JSON.stringify(pos));
function aqui(id){ // ¿va esta nota en el escritorio actual? Sin escritorio (o ya no existe) se queda en el actual
  const p=pos[id]||(pos[id]={});
  if(ahora&&(!p.desk||!todos.includes(p.desk))){p.desk=ahora;gp()}
  return !ahora||p.desk==ahora;
}
const colocar=(id,w=wins.get(id))=>{if(w&&!w.isDestroyed())aqui(id)?w.isVisible()||w.showInactive():w.hide()};
const PSD=`$k='HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';$p=''
function Lee($n){$b=[Microsoft.Win32.Registry]::GetValue($k,$n,$null);if($b){-join($b|%{$_.ToString('x2')})}}
while(Get-Process -Id ${process.pid} -EA 0){$c=Lee CurrentVirtualDesktop;$i=Lee VirtualDesktopIDs;if(!$c -and $i){$c=$i.Substring(0,32)} # Windows no escribe el actual hasta el primer cambio
$l="$c $i";if($l -ne $p){$p=$l;[Console]::Out.WriteLine($l);[Console]::Out.Flush()};Start-Sleep -Milliseconds 300}`;
function vigilarEscritorio(){ // un PowerShell avisa cada vez que cambia el escritorio; se cierra solo si muere la app
  let b='';
  spawn('powershell',['-NoProfile','-EncodedCommand',Buffer.from(PSD,'utf16le').toString('base64')],{stdio:['ignore','pipe','ignore'],windowsHide:true})
    .stdout.on('data',d=>{
      const l=(b+=d).split(/\r?\n/);b=l.pop();const u=l.pop();
      if(u){[ahora,todos='']=u.trim().split(' ');wins.forEach((w,id)=>colocar(id,w))}
    });
}

if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>showAll());
app.on('window-all-closed',()=>{}); // la app sigue viva en la bandeja

function open(n){
  if(wins.has(n.id)){const w=wins.get(n.id);if(ahora){(pos[n.id]||(pos[n.id]={})).desk=ahora;gp()} // «Mostrar todas»: la trae a este escritorio
    if(w.isMinimized())w.restore();return w.show()}
  const o=100+wins.size*30;
  const w=new BrowserWindow({x:o,y:o,width:340,height:340,minWidth:200,minHeight:150,...pos[n.id],
    icon:ICON,frame:false,skipTaskbar:true,show:false,backgroundColor:n.color,
    webPreferences:{preload:path.join(__dirname,'preload.js')}});
  w.loadFile('note.html',{query:{id:n.id}});
  w.once('ready-to-show',()=>{if(aqui(n.id))w.show();apply(w,n)});
  w.on('blur',()=>{if(find(n.id)?.z=='bottom'&&!w.isDestroyed())toBottom(w)}); // al soltar el foco, vuelve al fondo
  let t;const sp=()=>{pos[n.id]=Object.assign(pos[n.id]||{},w.getBounds());clearTimeout(t);t=setTimeout(gp,300)};
  w.on('moved',sp);w.on('resized',sp);
  w.on('restore',()=>w.setSkipTaskbar(true)); // minimizada sale en la barra de tareas; al volver, deja de salir
  w.on('closed',()=>{wins.delete(n.id);pintarLanz()});
  wins.set(n.id,w);
}
// La principal (n.main, o la primera) siempre se abre al iniciar; las demás solo si no están dormidas (n.dorm)
const principal=()=>notes.find(n=>n.main)||notes[0];
const inicia=n=>!n.dorm||n===principal();
const showAll=()=>notes.filter(n=>wins.has(n.id)||inicia(n)).forEach(open); // las dormidas se despiertan desde el menú de la bandeja
function add(){ // las nuevas nacen dormidas: abiertas ahora, pero no al próximo inicio
  const n={id:crypto.randomUUID(),color:COLORS[Math.random()*COLORS.length|0],html:'',dorm:true};
  notes.push(n);save();open(n);
}

// ---- eventos del calendario (eventos.js): Outlook clásico abierto (con color) o el enlace ICS (con los colores recordados); sin ninguno, la agenda del Calendario si está en la carpeta
// Con el Calendario instalado: notas-<equipo>.json lleva las líneas con hora de las notas unidas y agenda-<equipo>.json lo que escribe él (ver sync.js)
const guardarCfg=()=>fs.writeFileSync(CFG,JSON.stringify(cfg));
function exportar(){ // con un respiro: guardar se llama a cada tecla
  clearTimeout(tExp);
  tExp=setTimeout(()=>{
    if(!carpeta||!S.firmaAgenda(carpeta))return; // sin Calendario en la carpeta no hay a quién escribirle
    try{
      S.escribirNotas(carpeta,S.extraer(notes,new Date()));
    }catch(err){console.error('sync',err)}
  },1500);
}
let leyendo=false,fuenteEv={fuente:'ninguna'};
async function actualizarEventos(){
  if(leyendo)return;leyendo=true;
  try{
    const antes=JSON.stringify(colores),d=new Date(Date.now()-7*864e5),h=new Date(Date.now()+120*864e5); // la semana pasada y los 120 días siguientes
    const o=await E.obtener({ics:ajustes.ics,cache:colores,desde:d,hasta:h});
    fuenteEv=o;eventos=o.eventos;
    if(o.fuente=='ninguna'&&carpeta)eventos=S.leerAgenda(carpeta,d,127); // el Calendario, si está
    if(JSON.stringify(colores)!=antes)guardarSync();                    // colores recordados nuevos: se comparten con los demás equipos
    for(const n of notes)if(n.cal)wins.get(n.id)?.webContents.send('agenda',eventos);
  }catch(err){console.error('eventos',err)}finally{leyendo=false}
}
// ---- lanzador (clic en el icono de la bandeja): miniaturas de las notas, abrir/cerrar, cuáles arrancan y cuál es la principal (lanzador.html)
let lw,lwCerrado=0;
const cl=(v,lo,hi)=>Math.max(lo,Math.min(v,hi));
const pintarLanz=()=>{if(lw&&!lw.isDestroyed())lw.webContents.send('lanz',
  [...notes].sort((a,b)=>(b===principal())-(a===principal())).map(n=>({id:n.id,color:n.color,html:n.html,open:wins.has(n.id),start:inicia(n),main:n===principal()})))};
function lanzador(){
  if(Date.now()-lwCerrado<300)return; // el clic en la bandeja le quita el foco y lo cierra: no reabrirlo al instante
  if(lw)return lw.focus();
  const p=screen.getCursorScreenPoint(),a=screen.getDisplayNearestPoint(p).workArea,W=470,H=330;
  lw=new BrowserWindow({width:W,height:H,x:cl(p.x-W/2,a.x,a.x+a.width-W),y:cl(p.y-H-10,a.y,a.y+a.height-H),
    frame:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,show:false,backgroundColor:'#262626',icon:ICON,
    webPreferences:{preload:path.join(__dirname,'preload.js')}});
  lw.loadFile('lanzador.html');
  lw.once('ready-to-show',()=>{lw.show();pintarLanz()});
  lw.on('blur',()=>lw.close());
  lw.on('closed',()=>{lw=null;lwCerrado=Date.now()});
}
ipcMain.on('lanz',(e,a,id)=>{
  const n=find(id);
  if(a=='menu')return lanzador(); // desde el botón / Ctrl+L de una nota
  if(a=='nueva')add();
  else if(a=='abrir'&&n){open(n);wins.get(id)?.focus()}
  else if(a=='cerrar')wins.get(id)?.close();
  else if(a=='ini'&&n&&n!==principal()){n.dorm=n.dorm?undefined:true;save()}
  else if(a=='main'&&n){notes.forEach(x=>x.main=undefined);n.main=true;n.dorm=undefined;save()}
  if(a=='nueva'||a=='abrir'||a=='esc')lw?.close();else pintarLanz();
});
const menuBandeja=()=>tray.popUpContextMenu(Menu.buildFromTemplate([
  {label:'Nueva nota',click:add},{label:'Traer las abiertas a este escritorio',click:showAll},
  {label:'Calendario (Outlook o enlace ICS)…',click:ventanaCalendario},
  {label:'Carpeta de sincronización…',click:elegirCarpeta},{label:'Buscar actualizaciones…',click:()=>buscarActualizacion(true)},{type:'separator'},{label:'Salir',click:()=>app.exit()}]));
function elegirCarpeta(){ // una carpeta que sincronice OneDrive; las notas de los dos lados se fusionan
  const r=dialog.showOpenDialogSync({title:'Carpeta de sincronización (la que comparte OneDrive entre tus equipos)',defaultPath:cfg.sync||undefined,properties:['openDirectory','createDirectory']});
  if(!r)return;
  cfg.sync=r[0];carpeta=DATOS=r[0];guardarCfg();firma='';
  unir(S.leerSync(DATOS));firmaS=S.firmaSync(DATOS,S.ficheroEquipo(DATOS));guardarSync();exportar();actualizarEventos();
}
let cw;
function ventanaCalendario(){
  if(cw&&!cw.isDestroyed())return cw.focus();
  cw=new BrowserWindow({width:520,height:430,resizable:false,minimizable:false,autoHideMenuBar:true,icon:ICON,title:'Post-It · Calendario',backgroundColor:'#262626',
    webPreferences:{preload:path.join(__dirname,'preload.js')}});
  cw.loadFile('calendario.html');
}
ipcMain.handle('ics:get',()=>({ics:ajustes.ics||'',fuente:fuenteEv.fuente,estadoOutlook:fuenteEv.estadoOutlook||'',error:fuenteEv.error||'',n:eventos.length}));
ipcMain.handle('ics:probar',async(e,url)=>{
  try{const t=await E.bajar(String(url||'').trim());return {ok:true,n:E.eventosICS(t,new Date(),new Date(Date.now()+120*864e5)).length}}catch(err){return {ok:false,error:String(err.message||err)}}
});
ipcMain.handle('ics:guardar',async(e,url)=>{
  ajustes={ics:String(url||'').trim(),mod:Date.now()};guardarSync();await actualizarEventos();return true;
});
// ---- aviso de versión nueva: se mira la package.json publicada en GitHub (no se manda ningún dato). «Actualizar» baja el instalador de esa versión y lo abre;
// él conserva tus notas y tus ajustes. Se pregunta una vez por versión (o siempre que lo pidas desde la bandeja).
const VERSION=require('./package.json').version;
async function buscarActualizacion(aMano){
  try{
    const v=JSON.parse(await E.bajar('https://raw.githubusercontent.com/Kuerb0/Post-It-App/main/package.json')).version;
    if(!S.versionMayor(v,VERSION)){if(aMano)dialog.showMessageBox({type:'info',title:'Post-It',message:`Tienes la última versión (${VERSION}).`});return}
    if(!aMano&&cfg.avisada==v)return;
    cfg.avisada=v;guardarCfg();
    const r=await dialog.showMessageBox({type:'info',buttons:['Actualizar','Más tarde'],defaultId:0,cancelId:1,title:'Post-It',
      message:`Hay una versión nueva de Post-It (${v}); tienes la ${VERSION}.`,detail:'«Actualizar» descarga el instalador y lo abre. Tus notas y ajustes se conservan.'});
    if(r.response!=0)return;
    const f=path.join(app.getPath('temp'),`Post-It ${v} - Instalador.exe`),res=await net.fetch(`https://github.com/Kuerb0/Post-It-App/raw/main/instaladores/${encodeURIComponent(`Post-It ${v} - Instalador.exe`)}`);
    if(!res.ok)throw new Error('HTTP '+res.status);
    fs.writeFileSync(f,Buffer.from(await res.arrayBuffer()));shell.openPath(f);
  }catch(err){if(aMano)dialog.showMessageBox({type:'warning',title:'Post-It',message:'No se pudo comprobar las actualizaciones.',detail:String(err.message||err)})}
}
// ---- dónde viven las notas: se fija la primera vez (sync.json de la app) y no cambia solo
function ubicar(){
  CFG=path.join(app.getPath('userData'),'sync.json');cfg=read(CFG,{});
  if(cfg.sync===undefined){ // primera vez con la 2.0: si la 1.x tenía las notas fuera de la app (OneDrive), esa carpeta pasa a ser la de sincronización
    cfg.sync=cfg.notas&&path.resolve(cfg.notas)!=path.resolve(LOCAL)?path.dirname(cfg.notas):null;
    delete cfg.notas;delete cfg.carpeta;guardarCfg();
  }
  carpeta=cfg.sync||null;
  DATOS=carpeta||path.join(app.getPath('userData'),'datos');
}
// Une lo de la carpeta con lo que hay en memoria (nada al arrancar) y se queda con el resultado. Devuelve true si algo cambió.
function unir(archivos){
  const f=S.fusionar([{notas:notes,borradas,ajustes,colores},...archivos]);
  const cambio=JSON.stringify([f.notas,f.ajustes])!=JSON.stringify([notes,ajustes]);
  const habia=new Set(notes.map(n=>n.id));
  notes=f.notas;borradas=f.borradas;ajustes=f.ajustes;colores=f.colores;S.iniciarEstado(ESTADO,notes,borradas);
  return {cambio,habia};
}
function recargar(){ // otro equipo guardó (OneDrive trajo su fichero): se fusiona y se repintan las notas que no se están usando
  const f=S.firmaSync(DATOS,S.ficheroEquipo(DATOS));if(f==firmaS)return;firmaS=f;
  const {cambio,habia}=unir(S.leerSync(DATOS,{menos:S.ficheroEquipo(DATOS)}));
  if(!cambio)return;
  exportar();
  for(const [id,w] of wins)if(!find(id))w.close();
  for(const n of notes){
    const w=wins.get(n.id);
    if(!habia.has(n.id)){if(inicia(n))open(n)}
    else if(w&&!w.isFocused()){w.setBackgroundColor(n.color);apply(w,n);w.webContents.send('set',n)}
  }
  pintarLanz();if(ajustes.ics)actualizarEventos();
}
// ---- alarmas: el editor manda con cada guardado las de la nota (n.alarms). Suenan aunque la nota esté cerrada o dormida; las ya sonadas se recuerdan en este equipo
let sonadas=new Set();
function sonar(n,a){
  if(ahora){(pos[n.id]||(pos[n.id]={})).desk=ahora;gp()} // suena en el escritorio donde estás
  open(n);const w=wins.get(n.id);
  if(w){w.show();w.setAlwaysOnTop(true);w.focus();setTimeout(()=>{if(!w.isDestroyed())apply(w,find(n.id)||n,false)},8000)} // encima unos segundos
  shell.beep();
  const nt=new Notification({title:'⏰ '+a.txt,body:'Post-it · '+a.t.slice(11)});nt.on('click',()=>open(n));nt.show();
}
function comprobarAlarmas(){
  const v=S.alarmasVencidas(notes,sonadas);
  v.forEach(x=>{sonadas.add(x.clave);if(x.suena)sonar(x.nota,x.a)});
  if(v.length)fs.writeFileSync(ALM,JSON.stringify([...sonadas]));
}
function iniciarSync(){
  ALM=path.join(app.getPath('userData'),'alarmas.json');sonadas=new Set(read(ALM,[]));
  comprobarAlarmas();setInterval(comprobarAlarmas,15000);
  exportar();actualizarEventos();
  setInterval(actualizarEventos,300000);setInterval(recargar,3000);
  setTimeout(buscarActualizacion,20000);setInterval(buscarActualizacion,6*3600000);
  setInterval(exportar,3600000); // «hoy» y «mañana» cambian de dia aunque la nota no se toque
}

ipcMain.handle('get',(e,id)=>find(id));
ipcMain.on('save',(e,id,html,al)=>{const n=find(id);if(n){n.html=html;n.alarms=al?.length?al:undefined;save()}}); // al = alarmas de la nota ({t,txt}), ver comprobarAlarmas
ipcMain.on('color',(e,id,c)=>{ // c = #rrggbb elegido en el selector
  const n=find(id);if(!n||!/^#[0-9a-f]{6}$/i.test(c))return;
  n.color=c;save();win(e).setBackgroundColor(c);
});
ipcMain.handle('z',(e,id)=>{ // normal → encima → debajo → normal
  const n=find(id);n.z={undefined:'top',top:'bottom',bottom:undefined}[n.z];
  save();apply(win(e),n,false);return n.z;
});
ipcMain.handle('glass',(e,id)=>{
  const n=find(id);n.glass=n.glass?undefined:true;
  save();apply(win(e),n,false);return !!n.glass;
});
ipcMain.handle('cal',(e,id)=>{ // unir con el Calendario: sus tareas bajo una fecha van al Calendario y ven sus eventos
  const n=find(id);n.cal=n.cal?undefined:true;save();return !!n.cal;
});
ipcMain.handle('agenda',()=>eventos);
ipcMain.handle('estilo',()=>({fs:cfg.tam||15,lh:cfg.lh||1.35})); // letra (px) e interlineado: globales, valen para todas las notas
let tEst;
ipcMain.on('estilo',(e,f,l)=>{ // deslizadores: se reparte al momento al resto de notas y se guarda con un respiro
  const est={fs:Math.min(30,Math.max(9,+f||15)),lh:Math.min(2.6,Math.max(1,+l||1.35))};
  cfg.tam=est.fs;cfg.lh=est.lh;
  for(const w of wins.values())if(!w.isDestroyed()&&w.webContents!==e.sender)w.webContents.send('estilo',est);
  clearTimeout(tEst);tEst=setTimeout(guardarCfg,500);
});
ipcMain.handle('refrescar',()=>{ // botón ⟳: relee ya Outlook/ICS (y avisa al Calendario si está)
  if(carpeta&&S.firmaAgenda(carpeta))try{S.pedirRefresco(carpeta)}catch(err){console.error('refrescar',err)}
  actualizarEventos();
});
ipcMain.on('hechoCal',(e,id,k,v)=>{ // casilla de un evento del Calendario pintado en la nota; k = id del evento (uid@inicio)
  const n=find(id);if(!n)return;
  const s=new Set(n.calHechos),lim=S.iso(new Date(Date.now()-60*864e5));
  v?s.add(k):s.delete(k);
  const l=[...s].filter(x=>x.slice(-19,-9)>=lim); // los de hace más de 60 días ya no se pintan: se olvidan
  n.calHechos=l.length?l:undefined;save();
});
ipcMain.on('cols',(e,id,v)=>{const n=find(id);if(n){n.cols=v||undefined;save()}}); // máx. de columnas (0 = sin columnas)
ipcMain.on('new',add);
ipcMain.on('close',e=>win(e).close());
ipcMain.on('min',e=>{const w=win(e);w.setSkipTaskbar(false);w.minimize()});
ipcMain.on('del',(e,id)=>{
  const n=find(id);if(!n)return;
  if(n.html.replace(/<[^>]*>/g,'').trim()&&dialog.showMessageBoxSync(win(e),
    {type:'question',buttons:['Eliminar','Cancelar'],defaultId:1,cancelId:1,message:'¿Eliminar esta nota?'}))return;
  notes=notes.filter(x=>x!=n);save();win(e).close();
});

app.whenReady().then(()=>{
  app.setAppUserModelId('Post-It'); // para que Windows enseñe las notificaciones de las alarmas
  Menu.setApplicationMenu(null); // sin menú por defecto: sus atajos (Ctrl+W, Ctrl+R…) no deben pisar los de la nota
  POS=path.join(app.getPath('userData'),'pos.json');
  pos=read(POS,{});
  ubicar();
  todos=hex('VirtualDesktopIDs');ahora=hex('CurrentVirtualDesktop')||todos.slice(0,32);
  const arch=S.leerSync(DATOS);
  if(!carpeta||!arch.length)try{arch.push({notas:JSON.parse(fs.readFileSync(LOCAL,'utf8'))})}catch{} // notas de la 1.x junto a la app
  unir(arch);firmaS=S.firmaSync(DATOS,S.ficheroEquipo(DATOS));
  if(cfg.ics){ajustes={ics:cfg.ics,mod:Date.now()};delete cfg.ics;guardarCfg()} // el instalador deja aquí el enlace; pasa a la carpeta de sync
  const nueva=!notes.length;
  if(nueva)notes.push({id:crypto.randomUUID(),color:COLORS[0],html:BIENVENIDA});
  if(!nueva||ajustes.ics)save(); // la bienvenida no se escribe hasta que toques algo: si OneDrive aún no ha bajado tus notas, no las pisa
  showAll();iniciarSync();vigilarEscritorio();

  // arranque con Windows
  app.setLoginItemSettings({openAtLogin:true,path:process.execPath,args:[__dirname]});

  tray=new Tray(nativeImage.createFromPath(ICON).resize({width:16,height:16}));
  tray.setToolTip('Post-its');
  tray.on('click',lanzador);tray.on('right-click',menuBandeja);

});
