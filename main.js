const {app,BrowserWindow,Tray,Menu,ipcMain,nativeImage,dialog}=require('electron');
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');

const DATA=path.join(__dirname,'notes.json'); // vive en OneDrive → se sincroniza entre equipos
const ICON=path.join(__dirname,'assets','icon.png');
const COLORS=['#fff176','#ffab91','#a5d6a7','#81d4fa','#f48fb1','#ce93d8'];
let notes=[],pos={},last='',POS,tray;
const wins=new Map();
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const save=()=>fs.writeFileSync(DATA,last=JSON.stringify(notes,null,1));
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

if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>showAll());
app.on('window-all-closed',()=>{}); // la app sigue viva en la bandeja

function open(n){
  if(wins.has(n.id))return wins.get(n.id).show();
  const o=100+wins.size*30;
  const w=new BrowserWindow({x:o,y:o,width:340,height:340,minWidth:200,minHeight:150,...pos[n.id],
    icon:ICON,frame:false,skipTaskbar:true,show:false,backgroundColor:n.color,
    webPreferences:{preload:path.join(__dirname,'preload.js')}});
  w.loadFile('note.html',{query:{id:n.id}});
  w.once('ready-to-show',()=>{w.show();apply(w,n)});
  w.on('blur',()=>{if(find(n.id)?.z=='bottom'&&!w.isDestroyed())toBottom(w)}); // al soltar el foco, vuelve al fondo
  let t;const sp=()=>{pos[n.id]=w.getBounds();clearTimeout(t);t=setTimeout(()=>fs.writeFileSync(POS,JSON.stringify(pos)),300)};
  w.on('moved',sp);w.on('resized',sp);
  w.on('closed',()=>wins.delete(n.id));
  wins.set(n.id,w);
}
const showAll=()=>notes.forEach(open);
function add(){
  const n={id:crypto.randomUUID(),color:COLORS[Math.random()*COLORS.length|0],html:''};
  notes.push(n);save();open(n);
}

ipcMain.handle('get',(e,id)=>find(id));
ipcMain.on('save',(e,id,html)=>{const n=find(id);if(n){n.html=html;save()}});
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
ipcMain.on('cols',(e,id,v)=>{const n=find(id);if(n){n.cols=v||undefined;save()}}); // máx. de columnas (0 = sin columnas)
ipcMain.on('new',add);
ipcMain.on('close',e=>win(e).close());
ipcMain.on('del',(e,id)=>{
  const n=find(id);if(!n)return;
  if(n.html.replace(/<[^>]*>/g,'').trim()&&dialog.showMessageBoxSync(win(e),
    {type:'question',buttons:['Eliminar','Cancelar'],defaultId:1,cancelId:1,message:'¿Eliminar esta nota?'}))return;
  notes=notes.filter(x=>x!=n);save();win(e).close();
});

app.whenReady().then(()=>{
  Menu.setApplicationMenu(null); // sin menú por defecto: sus atajos (Ctrl+W, Ctrl+R…) no deben pisar los de la nota
  POS=path.join(app.getPath('userData'),'pos.json');
  pos=read(POS,{});
  notes=read(DATA,[]);
  if(!notes.length)notes.push({id:crypto.randomUUID(),color:COLORS[0],html:
    '<div>Bienvenido 👋 Escribe <b>-</b> + espacio para crear una tarea. Pulsa <b>F1</b> para ver los atajos.</div>'+
    '<div>Repetir: @diario @semanal @mensual @lunes @cada3d</div>'+
    '<div><input type="checkbox"> regar plantas @diario</div>'+
    '<div><input type="checkbox"> informe @lunes</div>'});
  save();showAll();

  // arranque con Windows
  app.setLoginItemSettings({openAtLogin:true,path:process.execPath,args:[__dirname]});

  tray=new Tray(nativeImage.createFromPath(ICON).resize({width:16,height:16}));
  tray.setToolTip('Post-its');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Nueva nota',click:add},{label:'Mostrar todas',click:showAll},{type:'separator'},{label:'Salir',click:()=>app.exit()}]));
  tray.on('click',showAll);

  // OneDrive trajo cambios de otro equipo → recargar
  fs.watchFile(DATA,{interval:3000},()=>{
    let s,j;try{s=fs.readFileSync(DATA,'utf8');if(s==last)return;j=JSON.parse(s)}catch{return}
    const had=new Set(notes.map(n=>n.id));last=s;notes=j;
    for(const [id,w] of wins)if(!find(id))w.close();
    for(const n of notes){
      const w=wins.get(n.id);
      if(!had.has(n.id))open(n);
      else if(w&&!w.isFocused()){w.setBackgroundColor(n.color);apply(w,n);w.webContents.send('set',n)}
    }
  });
});
