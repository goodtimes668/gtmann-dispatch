
import {
  acceptInvite,
  AuthError,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  signup,
  updateUser,
} from '@netlify/identity';
import { dispatchBreakdown } from '../netlify/functions/_shared/cost';
import { validateSignup } from './auth';

var API = '/api';
var currentUser = null;
var authCallback = null;
var authMode = 'login';
var signupEnabled = true;

var LOW_VALUE_THRESHOLD = 25; // $ — flag non-urgent dispatches above this
var sites = [];
var sitesSynced = false;
var editSiteIdx = null;
var siteAddressSuggestions = [];
var siteAddressTimer = null;
var siteAddressEpoch = 0;
var selectedSiteAddress = '';
var siteRoutePending = false;

var bookings = [];
var curType = 'delivery';
var curPri = 'normal';
var curPhoto = null;
var curPhotoFile = null;
var curPhotoPreviewUrl = null;
var bundleRequested = false;
var editId = null;
var calDate = new Date(); // month currently shown on the Calendar tab
var overlayFocusStack = [];

function uid(){ return crypto.randomUUID(); }
function toISODate(d){
  var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
function today(){ return toISODate(new Date()); }
function el(id){ return document.getElementById(id); }

function esc(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ---- icons ---- */
var ICONS = {
  truck:'<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  package:'<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  file:'<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  clipboard:'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  hardhat:'<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><path d="M14 6a6 6 0 0 1 6 6v3"/>',
  refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  calendar:'<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  play:'<polygon points="6 3 20 12 6 21 6 3"/>',
  checkcircle:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  inbox:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  edit:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock:'<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  mappin:'<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  dollarsign:'<line x1="12" x2="12" y1="1" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
  chevronleft:'<path d="m15 18-6-6 6-6"/>',
  chevronright:'<path d="m9 18 6-6-6-6"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>'
};
function ico(name,size,color){
  return '<svg width="'+(size||18)+'" height="'+(size||18)+'" viewBox="0 0 24 24" fill="none" stroke="'+(color||'currentColor')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[name]||'')+'</svg>';
}
function hydrateIcons(root){
  var nodes=(root||document).querySelectorAll('[data-ic]');
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i];
    n.innerHTML=ico(n.getAttribute('data-ic'), n.getAttribute('data-s')||18, n.getAttribute('data-c')||'currentColor');
  }
}
function emptyState(icon,msg){
  return '<div class="empty">'+ico(icon,26,'currentColor').replace('<svg','<svg style="margin:0 auto 10px;opacity:.5"')+'<div>'+msg+'</div></div>';
}

function showOverlay(id){
  var overlay=el(id);
  overlayFocusStack.push(document.activeElement);
  overlay.classList.add('show');
  requestAnimationFrame(function(){
    var target=overlay.querySelector('input:not([type="hidden"]),textarea,select,button,[tabindex="-1"]');
    if(target) target.focus();
  });
}
function hideOverlay(id){
  el(id).classList.remove('show');
  var target=overlayFocusStack.pop();
  if(target&&document.contains(target)&&typeof target.focus==='function') target.focus();
}

/* ---- toasts ---- */
function toast(msg,kind){
  var t=document.createElement('div');
  t.className='toast'+(kind?' '+kind:'');
  t.innerHTML=(kind==='err'?ico('alert',15,'var(--red)'):kind==='ok'?ico('check',15,'var(--green)'):kind==='warn'?ico('clock',15,'var(--amber)'):ico('refresh',15,'var(--yellow)'))+'<span>'+esc(msg)+'</span>';
  el('toasts').appendChild(t);
  requestAnimationFrame(function(){ t.classList.add('show'); });
  setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); },250); },3200);
}

/* ---- authenticated roles ---- */
function hasRole(role){ return !!(currentUser&&currentUser.roles&&currentUser.roles.indexOf(role)!==-1); }
function isDispatcher(){ return hasRole('dispatcher')||hasRole('manager'); }
function isManager(){ return hasRole('manager'); }
function renderLock(){
  var b=el('lockBtn');
  b.innerHTML=ico('logout',16);
  b.className='iconbtn'+(isDispatcher()?' unlocked':'');
  b.title=(currentUser?currentUser.name:'Account')+' — sign out';
  var role=isManager()?'Manager':isDispatcher()?'Dispatcher':'Member';
  el('userRole').textContent=(currentUser?currentUser.name:'Account')+' · '+role;
}

function setAuthMessage(message,kind){
  var box=el('authMessage');
  box.textContent=message||'';
  box.className='authmessage'+(kind?' '+kind:'');
}

function setAuthMode(mode){
  authMode=mode;
  var email=el('authEmail'), password=el('authPassword'), submit=el('authSubmit');
  var name=el('authName'), confirmPassword=el('authPasswordConfirm');
  var emailLabel=email.previousElementSibling;
  var nameWrap=el('authNameWrap'), confirmWrap=el('authPasswordConfirmWrap');
  var forgot=el('authForgot'), toggle=el('authModeToggle');
  var special=mode==='invite'||mode==='recovery';
  var signingUp=mode==='signup';
  email.hidden=special; emailLabel.hidden=special; email.required=!special;
  nameWrap.classList.toggle('hidden',!signingUp); name.required=signingUp;
  confirmWrap.classList.toggle('hidden',!signingUp); confirmPassword.required=signingUp;
  forgot.hidden=special||signingUp;
  toggle.hidden=special||!signupEnabled;
  toggle.textContent=signingUp?'Already have an account? Sign in':'Need an account? Sign up';
  password.autocomplete=(special||signingUp)?'new-password':'current-password';
  submit.textContent=mode==='invite'?'Accept Invite':mode==='recovery'?'Set New Password':signingUp?'Create Account':'Sign In';
  document.querySelector('.authcopy').textContent=mode==='invite'
    ?'Choose a password to activate your GT Mann account.'
    :mode==='recovery'?'Enter a new password for your account.'
    :signingUp?'Create a requester account. You will confirm your email before signing in.'
    :'Sign in with your GT Mann account.';
}

async function loadSignupAvailability(){
  try{
    var settings=await getSettings();
    signupEnabled=!settings.disableSignup;
  }catch(error){
    // Keep the form available if settings cannot be fetched; signup will return a useful error if disabled.
    signupEnabled=true;
  }
  setAuthMode(authMode);
}

function toggleAuthMode(){
  setAuthMessage('');
  setAuthMode(authMode==='signup'?'login':'signup');
  (authMode==='signup'?el('authName'):el('authEmail')).focus();
}

async function submitAuth(event){
  event.preventDefault();
  var button=el('authSubmit');
  button.disabled=true; setAuthMessage('Working…');
  try{
    var user;
    if(authCallback&&authCallback.type==='invite') user=await acceptInvite(authCallback.token,el('authPassword').value);
    else if(authCallback&&authCallback.type==='recovery') user=await updateUser({password:el('authPassword').value});
    else if(authMode==='signup'){
      var validationError=validateSignup({
        name:el('authName').value,
        password:el('authPassword').value,
        confirmation:el('authPasswordConfirm').value,
      });
      if(validationError){ setAuthMessage(validationError,'err'); return false; }
      var email=el('authEmail').value.trim();
      user=await signup(email,el('authPassword').value,{full_name:el('authName').value.trim()});
      if(!user.confirmedAt){
        el('authPassword').value=''; el('authPasswordConfirm').value='';
        setAuthMode('login');
        setAuthMessage('Account created. Check your email to confirm it, then sign in.','ok');
        return false;
      }
    } else user=await login(el('authEmail').value.trim(),el('authPassword').value);
    await startAuthenticated(user);
  }catch(error){
    var raw=(error.message||'').toLowerCase();
    var message=error instanceof AuthError&&error.status===401?'Invalid email or password.'
      :authMode==='signup'&&(error.status===403||raw.indexOf('signup')!==-1&&raw.indexOf('disable')!==-1)
        ?'New account signup is temporarily unavailable. Ask a manager for access.'
        :authMode==='signup'&&(raw.indexOf('already')!==-1||raw.indexOf('registered')!==-1)
          ?'An account already exists for that email. Sign in or reset your password.'
          :(error.message||'Unable to continue.');
    setAuthMessage(message,'err');
  }finally{ button.disabled=false; }
  return false;
}

async function forgotPassword(){
  var email=el('authEmail').value.trim();
  if(!email){ setAuthMessage('Enter your email address first.','err'); return; }
  try{ await requestPasswordRecovery(email); setAuthMessage('Password reset email sent.','ok'); }
  catch(error){ setAuthMessage(error.message||'Could not send reset email.','err'); }
}

async function signOut(){
  try{ await logout(); }
  catch(error){ /* Clear local state even if the network is already gone. */ }
  finally{
    endSession();
    setAuthMode('login');
    setAuthMessage('Signed out.','ok');
  }
}

function endSession(){
  currentUser=null; bookings=[]; sites=[]; sitesSynced=false;
  if(curPhotoPreviewUrl) URL.revokeObjectURL(curPhotoPreviewUrl);
  curPhotoPreviewUrl=null; curPhotoFile=null; curPhoto=null; editId=null;
  el('appShell').classList.add('hidden');
  el('authGate').classList.remove('hidden');
}

/* ---- offline retry queue ---- */
var outboxDbPromise=null;
function openOutbox(){
  if(outboxDbPromise) return outboxDbPromise;
  outboxDbPromise=new Promise(function(resolve,reject){
    var request=indexedDB.open('gtd_dispatch',1);
    request.onupgradeneeded=function(){ if(!request.result.objectStoreNames.contains('actions')) request.result.createObjectStore('actions',{keyPath:'id'}); };
    request.onsuccess=function(){ resolve(request.result); };
    request.onerror=function(){ reject(request.error); };
  });
  return outboxDbPromise;
}
async function outboxPut(item){
  var db=await openOutbox();
  return new Promise(function(resolve,reject){ var tx=db.transaction('actions','readwrite'); tx.objectStore('actions').put(item); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error);}; });
}
async function outboxDelete(id){
  var db=await openOutbox();
  return new Promise(function(resolve,reject){ var tx=db.transaction('actions','readwrite'); tx.objectStore('actions').delete(id); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error);}; });
}
async function getQueue(){
  var db=await openOutbox();
  return new Promise(function(resolve,reject){ var tx=db.transaction('actions','readonly'); var req=tx.objectStore('actions').getAll(); req.onsuccess=function(){resolve(req.result||[]);}; req.onerror=function(){reject(req.error);}; });
}
async function getUserQueue(){
  var all=await getQueue();
  return currentUser?all.filter(function(item){ return item.userId===currentUser.id; }):[];
}

function ApiError(status,message,details){ this.name='ApiError'; this.status=status; this.message=message; this.details=details; }
ApiError.prototype=Object.create(Error.prototype);
function retryable(error){ return !error.status||error.status===408||error.status===429||error.status>=500; }

async function apiRequest(method,path,body,options){
  options=options||{};
  var headers=new Headers(options.headers||{});
  var payload;
  if(body instanceof FormData) payload=body;
  else if(body!==undefined&&body!==null){ headers.set('Content-Type','application/json'); payload=JSON.stringify(body); }
  var response;
  try{ response=await fetch(API+path,{method:method,headers:headers,body:payload,credentials:'same-origin'}); }
  catch(error){ throw new ApiError(0,'Network unavailable'); }
  var data=await response.json().catch(function(){return null;});
  if(!response.ok){
    if(response.status===401) endSession();
    throw new ApiError(response.status,(data&&data.error)||('Request failed ('+response.status+')'),data&&data.details);
  }
  return data;
}

async function uploadPhoto(file,key){
  var form=new FormData(); form.append('photo',file,file.name||'dispatch-photo.jpg');
  return apiRequest('POST','/photos',form,{headers:{'Idempotency-Key':key}});
}

async function apiCall(method,path,body,okMsg,options){
  options=options||{};
  var actionId=options.idempotencyKey||uid();
  var queuedPhoto=options.photoFile||null;
  try{
    if(options.photoFile){
      var uploaded=await uploadPhoto(options.photoFile,actionId+':photo');
      body.photoId=uploaded.id;
      queuedPhoto=null;
    }
    var headers=method!=='GET'?{'Idempotency-Key':actionId}:{};
    var result=await apiRequest(method,path,body,{headers:headers});
    if(okMsg) toast(okMsg,'ok');
    return result;
  }catch(error){
    if(method!=='GET'&&retryable(error)&&options.queue!==false){
      if(method==='PUT'){
        var prior=(await getUserQueue()).filter(function(item){ return item.method==='PUT'&&item.path===path&&item.state!=='blocked'; });
        await Promise.all(prior.map(function(item){ return outboxDelete(item.id); }));
      }
      try{
        await outboxPut({id:actionId,userId:currentUser.id,method:method,path:path,body:body,photoFile:queuedPhoto,createdAt:Date.now(),state:'pending'});
      }catch(storageError){
        toast('Could not save this change offline. Reconnect and try again.','err');
        throw new ApiError(507,'Offline storage is unavailable');
      }
      renderQueueStatus();
      toast('Saved offline — will sync automatically','warn');
      return {_queued:true,_tempId:options.tempId||actionId};
    }
    toast(error.message||'Request failed','err');
    throw error;
  }
}

async function flushQueue(){
  if(!currentUser) return 0;
  var queue=await getUserQueue();
  var synced=0, blocked=0;
  for(var i=0;i<queue.length;i++){
    var item=queue[i];
    try{
      if(item.photoFile){ var uploaded=await uploadPhoto(item.photoFile,item.id+':photo'); item.body.photoId=uploaded.id; }
      await apiRequest(item.method,item.path,item.body,{headers:{'Idempotency-Key':item.id}});
      await outboxDelete(item.id); synced++;
    }catch(error){
      if(!retryable(error)){ item.state='blocked'; item.error=error.message; await outboxPut(item); blocked++; }
    }
  }
  if(synced) toast('Synced '+synced+' pending change'+(synced===1?'':'s'),'ok');
  if(blocked) toast(blocked+' queued change'+(blocked===1?' needs':'s need')+' attention','err');
  await renderQueueStatus();
  return synced;
}

/* ---- job sites ---- */

async function loadSites(){
  try{
    var remote=await apiRequest('GET','/sites');
    sites=Array.isArray(remote)?remote:[];
    sitesSynced=true;
  }catch(error){
    sitesSynced=false;
    toast('Job sites could not be refreshed','warn');
  }
  renderSiteOptions(); renderSitesManager();
}

async function apiSaveSite(rec,oldName){
  var path=oldName?('/sites/'+encodeURIComponent(oldName)):'/sites';
  var method=oldName?'PUT':'POST';
  var saved=await apiCall(method,path,rec,'Site saved',{queue:false,idempotencyKey:uid()});
  sitesSynced=true; renderSyncBadge();
  return saved;
}
async function apiDeleteSite(site){
  return apiCall('DELETE','/sites/'+encodeURIComponent(site.name)+'?version='+encodeURIComponent(site.version),null,'Site removed',{queue:false});
}

function renderSyncBadge(){
  var b=el('sitesSyncBadge'); if(!b) return;
  b.innerHTML=sitesSynced
    ?'<span class="badge b-approved"><span class="dot"></span>Synced</span>'
    :'<span class="badge b-pending"><span class="dot"></span>Connection Issue</span>';
}

function renderSiteOptions(){
  var sel=el('fSite'); if(!sel) return;
  var current=sel.value;
  var html='<option value="">— Select job site —</option>';
  sites.slice().sort(function(a,b){ return a.name.localeCompare(b.name); }).forEach(function(s){
    html+='<option value="'+esc(s.name)+'">'+esc(s.name)+(s.address?' — '+esc(s.address):'')+'</option>';
  });
  html+='<option value="__other__">Other / Not Listed</option>';
  sel.innerHTML=html;
  var stillExists=Array.prototype.some.call(sel.options,function(o){ return o.value===current; });
  sel.value=stillExists?current:'';
}

function siteRowHTML(s,idx){
  var routeTag=s.routeSource==='mapbox'?' · <span style="color:var(--green)">live road route</span>':s.routeSource==='estimated'?' · <span style="color:var(--amber)">estimated route</span>':'';
  return '<div class="bcard" role="button" tabindex="0" aria-label="Edit '+esc(s.name)+'" style="--bc:var(--border);cursor:pointer" data-action="open-site" data-site-index="'+idx+'">'
    +'<div class="row" style="margin-bottom:0"><div><div class="ttl" style="font-size:14px">'+esc(s.name)+'</div>'
    +(s.address?'<div class="sub">'+esc(s.address)+'</div>':'')
    +'<div class="sub mono">'+s.min+' min · '+s.km+' km round trip'+routeTag+'</div></div>'
    +ico('edit',15,'var(--faint)')+'</div></div>';
}

function renderSitesManager(){
  var wrap=el('sitesSection'); if(!wrap) return;
  var disp=isDispatcher();
  wrap.className=disp?'':'hidden';
  if(!disp) return;
  renderSyncBadge();
  var list=el('sitesList');
  list.innerHTML=sites.length
    ? sites.map(function(s,i){ return siteRowHTML(s,i); }).join('')
    : emptyState('mappin','No sites added yet');
}

function currentSiteName(){
  var v=el('fSite')?el('fSite').value:'';
  if(v==='__other__') return (el('fSiteOther')?el('fSiteOther').value.trim():'');
  return v;
}
function onSiteChange(){
  el('fSiteOtherWrap').className=el('fSite').value==='__other__'?'':'hidden';
  renderCostEstimate();
}
function setSiteField(name){
  var match=sites.some(function(s){ return s.name===name; });
  if(name&&!match){
    el('fSite').value='__other__';
    if(el('fSiteOther')) el('fSiteOther').value=name;
    el('fSiteOtherWrap').className='';
  } else {
    el('fSite').value=name||'';
    if(el('fSiteOther')) el('fSiteOther').value='';
    el('fSiteOtherWrap').className='hidden';
  }
}

function openSiteForm(idx){
  editSiteIdx=(typeof idx==='number')?idx:null;
  var s=editSiteIdx!==null?sites[editSiteIdx]:null;
  el('sfTitle').textContent=s?'Edit Site':'Add Site';
  el('sfName').value=s?s.name:'';
  el('sfAddress').value=s&&s.address?s.address:'';
  el('sfMin').value=s?s.min:'';
  el('sfKm').value=s?s.km:'';
  el('sfLat').value=(s&&typeof s.lat==='number')?s.lat:'';
  el('sfLng').value=(s&&typeof s.lng==='number')?s.lng:'';
  selectedSiteAddress=s&&s.address?s.address:'';
  siteAddressSuggestions=[];
  hideAddressSuggestions();
  setRouteStatus(s&&s.routeSource==='mapbox'?'Live road round trip from Faithwood Farms.':s&&s.routeSource==='estimated'?'Approximate road round trip from Faithwood Farms. Add a Mapbox token for live roads.':'Select an address to calculate the round trip from Faithwood Farms, 4368 Lochside Drive.',s&&s.routeSource==='mapbox'?'ok':s&&s.routeSource==='estimated'?'warn':'');
  el('sfDelete').className=s?'':'hidden';
  showOverlay('siteFormOverlay');
}
function closeSiteForm(){
  if(siteAddressTimer) clearTimeout(siteAddressTimer);
  siteAddressEpoch++;
  hideAddressSuggestions();
  hideOverlay('siteFormOverlay'); editSiteIdx=null;
}

function setRouteStatus(message,kind){
  var status=el('sfRouteStatus');
  status.textContent=message;
  status.className='route-status'+(kind?' '+kind:'');
}

function hideAddressSuggestions(){
  var list=el('sfAddressResults');
  if(!list) return;
  list.classList.add('hidden');
  el('sfAddress').setAttribute('aria-expanded','false');
}

function renderAddressSuggestions(message){
  var list=el('sfAddressResults');
  if(message){
    list.innerHTML='<div class="address-message">'+esc(message)+'</div>';
  } else {
    list.innerHTML=siteAddressSuggestions.map(function(suggestion,index){
      return '<button type="button" class="address-option" role="option" data-action="choose-site-address" data-address-index="'+index+'">'+esc(suggestion.label)+'</button>';
    }).join('');
  }
  list.classList.remove('hidden');
  el('sfAddress').setAttribute('aria-expanded','true');
}

function onSiteAddressInput(){
  var query=el('sfAddress').value.trim();
  selectedSiteAddress='';
  el('sfLat').value=''; el('sfLng').value=''; el('sfMin').value=''; el('sfKm').value='';
  setRouteStatus('Choose a matching address from the suggestions to calculate the route.');
  if(siteAddressTimer) clearTimeout(siteAddressTimer);
  var epoch=++siteAddressEpoch;
  if(query.length<3){ hideAddressSuggestions(); return; }
  renderAddressSuggestions('Searching addresses…');
  siteAddressTimer=setTimeout(async function(){
    try{
      var result=await apiRequest('GET','/locations?q='+encodeURIComponent(query));
      if(epoch!==siteAddressEpoch) return;
      siteAddressSuggestions=Array.isArray(result.suggestions)?result.suggestions:[];
      if(siteAddressSuggestions.length) renderAddressSuggestions();
      else renderAddressSuggestions('No matching B.C. addresses found. Try adding the city or postal code.');
    }catch(error){
      if(epoch!==siteAddressEpoch) return;
      renderAddressSuggestions('Address lookup is unavailable right now. Please try again.');
    }
  },350);
}

async function chooseSiteAddress(index){
  var suggestion=siteAddressSuggestions[index]; if(!suggestion) return;
  selectedSiteAddress=suggestion.address;
  el('sfAddress').value=suggestion.address;
  el('sfLat').value=suggestion.lat;
  el('sfLng').value=suggestion.lng;
  hideAddressSuggestions();
  siteRoutePending=true; el('sfSave').disabled=true;
  setRouteStatus('Calculating the round trip from Faithwood Farms…');
  try{
    var route=await apiRequest('GET','/route?lat='+encodeURIComponent(suggestion.lat)+'&lng='+encodeURIComponent(suggestion.lng));
    el('sfMin').value=route.roundTripMinutes;
    el('sfKm').value=route.roundTripKm;
    if(route.source==='mapbox') setRouteStatus('Live road route from Faithwood Farms.','ok');
    else setRouteStatus('Approximate road route from Faithwood Farms. Add a Mapbox token for live road distance.','warn');
  }catch(error){
    el('sfMin').value=''; el('sfKm').value='';
    setRouteStatus('The route could not be calculated. Choose the address again or retry shortly.','err');
  }finally{
    siteRoutePending=false; el('sfSave').disabled=false;
  }
}

async function saveSite(){
  var name=el('sfName').value.trim();
  var address=el('sfAddress').value.trim();
  var min=parseFloat(el('sfMin').value);
  var km=parseFloat(el('sfKm').value);
  var latRaw=el('sfLat').value.trim();
  var lngRaw=el('sfLng').value.trim();
  if(siteRoutePending){ toast('Wait for the route calculation to finish','warn'); return; }
  if(!name){ toast('Enter a site name','err'); el('sfName').focus(); return; }
  if(!address||address!==selectedSiteAddress||latRaw===''||lngRaw===''){ toast('Choose the site address from the suggestions','err'); el('sfAddress').focus(); return; }
  if(isNaN(min)||isNaN(km)||min<0||km<0){ toast('The route needs to be calculated before saving','err'); return; }
  var dup=sites.some(function(s,i){ return i!==editSiteIdx && s.name.toLowerCase()===name.toLowerCase(); });
  if(dup){ toast('That site already exists','err'); return; }
  var rec={name:name,address:address,min:min,km:km};
  if(latRaw!==''&&lngRaw!==''){
    var lat=parseFloat(latRaw), lng=parseFloat(lngRaw);
    if(!isNaN(lat)&&!isNaN(lng)){ rec.lat=lat; rec.lng=lng; }
  }
  try{
    var saved;
    if(editSiteIdx!==null){
      var oldName=sites[editSiteIdx].name;
      rec.version=sites[editSiteIdx].version;
      saved=await apiSaveSite(rec,oldName);
      sites[editSiteIdx]=saved;
    } else {
      saved=await apiSaveSite(rec,null);
      sites.push(saved);
    }
    renderSiteOptions(); renderSitesManager(); closeSiteForm();
  }catch(error){}
}

async function deleteSite(){
  if(editSiteIdx===null) return;
  if(!confirm('Remove this site? Existing bookings keep the site name as text.')) return;
  var rec=sites[editSiteIdx];
  try{
    await apiDeleteSite(rec);
    sites.splice(editSiteIdx,1);
    renderSiteOptions(); renderSitesManager(); closeSiteForm();
  }catch(error){}
}

/* ---- formatting ---- */
function fmtD(d){
  if(!d) return '—';
  try{ return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
  catch(e){ return d; }
}
function fmtT(t){
  if(!t) return '';
  try{ var p=t.split(':'); var h=parseInt(p[0]); return ((h%12)||12)+':'+p[1]+(h>=12?'PM':'AM'); }
  catch(e){ return t; }
}
function isToday(d){ return d===today(); }
function isThisWeek(d){
  var n=new Date(), s=new Date(n);
  s.setDate(n.getDate()-n.getDay());
  s.setHours(0,0,0,0);
  var e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59,999);
  try{ var dt=new Date(d+'T12:00:00'); return dt>=s&&dt<=e; }catch(e){ return false; }
}

/* ---- data ---- */
async function loadData(){
  try{
    var data=await apiRequest('GET','/bookings');
    bookings=Array.isArray(data)?data:[];
  }catch(error){ toast('Bookings could not be refreshed','warn'); }
  await mergeQueued(); renderAll();
}
async function mergeQueued(){
  var queue=await getUserQueue();
  queue.forEach(function(item){
    if(item.method==='POST'&&item.path==='/bookings'&&item.body){
      var tempId=item.id;
      if(!bookings.some(function(b){ return b.id===tempId; })){
        bookings.push(Object.assign({
          id:tempId, version:1, status:'pending', requester:currentUser?currentUser.name:'Team member',
          createdAt:new Date(item.createdAt).toISOString(), _queued:true, _queueBlocked:item.state==='blocked'
        },item.body));
      }
    }
  });
  await renderQueueStatus();
}
async function renderQueueStatus(){
  var box=el('queueStatus'); if(!box) return;
  var queue=await getUserQueue();
  if(!queue.length){ box.innerHTML=''; return; }
  var blocked=queue.filter(function(item){ return item.state==='blocked'; });
  var message=blocked.length
    ? blocked.length+' offline change'+(blocked.length===1?' could':'s could')+' not sync.'
    : queue.length+' change'+(queue.length===1?' is':'s are')+' waiting to sync.';
  box.innerHTML='<div class="queue-alert" role="status"><div>'+ico(blocked.length?'alert':'clock',15)+'<span>'+esc(message)+'</span></div>'
    +(blocked.length?'<button type="button" data-action="clear-blocked">Discard blocked</button>':'')+'</div>';
}
async function clearBlockedQueue(){
  var queue=await getUserQueue();
  var blocked=queue.filter(function(item){ return item.state==='blocked'; });
  if(!blocked.length||!confirm('Discard '+blocked.length+' blocked offline change'+(blocked.length===1?'':'s')+'?')) return;
  await Promise.all(blocked.map(function(item){ return outboxDelete(item.id); }));
  toast('Blocked offline changes discarded','warn');
  await loadData();
}
async function discardQueued(id){
  if(!confirm('Discard this unsynced booking from this device?')) return;
  await outboxDelete(id); closeDetail(); await loadData();
}
async function manualRefresh(){
  await flushQueue();
  await loadSites();
  await loadData();
}

/* ---- metrics ---- */
function renderMetrics(){
  var cutoff=Date.now()-30*24*60*60*1000;
  var recent=bookings.filter(function(b){
    var t=Date.parse(b.createdAt||''); return !isNaN(t)&&t>=cutoff;
  });
  var done=recent.filter(function(b){ return b.status==='completed'; });
  el('mDone').textContent=done.length;
  var turns=done.map(function(b){
    var a=Date.parse(b.createdAt||''), z=Date.parse(b.completedAt||'');
    return (!isNaN(a)&&!isNaN(z)&&z>=a)?(z-a)/86400000:null;
  }).filter(function(x){ return x!==null; });
  el('mTurn').textContent=turns.length?(turns.reduce(function(s,x){ return s+x; },0)/turns.length).toFixed(1):'—';
  var counts={};
  recent.forEach(function(b){ if(b.site) counts[b.site]=(counts[b.site]||0)+1; });
  var top=Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; })[0];
  el('mSite').textContent=top||'—';
  var spend=recent.filter(function(b){ return b.status!=='declined'; })
    .reduce(function(s,b){ return s+(typeof b.estCost==='number'?b.estCost:0); },0);
  el('mSpend').textContent=spend>0?'$'+Math.round(spend):'—';
}

/* ---- render ---- */
function renderAll(){
  var now=new Date();
  el('todayTxt').textContent=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  var pend=bookings.filter(function(b){ return b.status==='pending'; });
  var tod=bookings.filter(function(b){ return isToday(b.date)&&b.status!=='declined'; });
  var wk=bookings.filter(function(b){ return isThisWeek(b.date)&&b.status!=='declined'; });
  var urg=bookings.filter(function(b){ return b.priority==='urgent'&&b.status!=='completed'&&b.status!=='declined'; });
  var inProgress=bookings.filter(function(b){ return b.status==='in-progress'; });
  var scheduledToday=bookings.filter(function(b){ return isToday(b.date)&&b.status==='approved'; });
  el('nP').textContent=pend.length; el('nT').textContent=tod.length; el('nW').textContent=wk.length; el('nU').textContent=urg.length;
  el('brentTxt').textContent=inProgress.length
    ?'Brent is currently on '+inProgress.length+' job'+(inProgress.length===1?'':'s')
    :scheduledToday.length?scheduledToday.length+' approved job'+(scheduledToday.length===1?'':'s')+' scheduled today':'Brent has no active dispatch';
  el('brentCnt').textContent=pend.length>0?pend.length+' job'+(pend.length>1?'s':'')+' need approval':'All clear';
  var up=bookings.filter(function(b){ return b.status!=='completed'&&b.status!=='declined'&&b.date>=today(); }).sort(function(a,b){ return a.date.localeCompare(b.date); }).slice(0,5);
  el('homeList').innerHTML=up.length?up.map(function(b){ return cardHTML(b,false); }).join(''):emptyState('inbox','No upcoming bookings');
  var all=bookings.slice().sort(function(a,b){ return (b.createdAt||'').localeCompare(a.createdAt||''); });
  el('allList').innerHTML=all.length?all.map(function(b){ return cardHTML(b,false); }).join(''):emptyState('inbox','No bookings yet');
  var bTod=bookings.filter(function(b){ return isToday(b.date)&&(b.status==='approved'||b.status==='in-progress'); })
    .sort(function(a,b){ return (a.time||'99:99').localeCompare(b.time||'99:99'); });
  var bUp=bookings.filter(function(b){ return b.date>today()&&(b.status==='approved'||b.status==='in-progress'); }).sort(function(a,b){ return a.date.localeCompare(b.date); }).slice(0,8);
  el('bPending').innerHTML=pend.length?pend.map(function(b){ return cardHTML(b,false); }).join(''):emptyState('checkcircle','No pending requests');
  el('bToday').innerHTML=bTod.length?bTod.map(function(b){ return cardHTML(b,true); }).join(''):emptyState('calendar','No jobs today');
  el('bUpcoming').innerHTML=bUp.length?bUp.map(function(b){ return cardHTML(b,false); }).join(''):emptyState('calendar','No upcoming jobs');
  renderMetrics();
  renderCalendar();
}

function cardHTML(b,runsheet){
  var ic={delivery:'package',pickup:'wrench','tool-delivery':'truck',misc:'file'};
  var lb={delivery:'Material Delivery',pickup:'Tool Pickup','tool-delivery':'Tool Delivery',misc:'Misc Task'};
  var sl={pending:'Pending',approved:'Approved',declined:'Declined',completed:'Done','in-progress':'In Progress'};
  var scls={pending:'b-pending',approved:'b-approved',declined:'b-declined',completed:'b-completed','in-progress':'b-in-progress'};
  var bc=b.priority==='urgent'?'var(--red)':b.status==='approved'?'var(--green)':b.status==='completed'?'var(--blue)':'var(--yellow)';
  var desc=(b.description||'').slice(0,80)+((b.description||'').length>80?'...':'');
  var badge=b._queued
    ? '<span class="badge '+(b._queueBlocked?'b-declined':'b-queued')+'"><span class="dot"></span>'+(b._queueBlocked?'Needs Attention':'Queued')+'</span>'
    : '<span class="badge '+(scls[b.status]||'b-pending')+'"><span class="dot"></span>'+esc(sl[b.status]||b.status)+'</span>';
  var when=runsheet
    ? (b.time?fmtT(b.time):'Anytime')
    : fmtD(b.date)+(b.time?' · '+fmtT(b.time):'');
  var extras='';
  if(b.photo||b.photoId) extras+=' <span style="display:inline-flex;vertical-align:-2px">'+ico('camera',12,'var(--faint)')+'</span>';
  var loc='';
  if(runsheet&&(b.pickupLocation||b.site)){
    loc='<div class="sub" style="display:flex;align-items:center;gap:5px;margin-top:6px">'+ico('mappin',12,'var(--faint)')+esc(b.pickupLocation||b.site)+'</div>';
  }
  return '<div class="bcard'+(runsheet?' runsheet':'')+'" role="button" tabindex="0" aria-label="Open '+esc(lb[b.type]||b.type)+' booking" style="--bc:'+bc+'" data-action="open-detail" data-booking-id="'+esc(b.id)+'">'
    +'<div class="row"><div style="flex:1;padding-right:8px">'
    +'<div class="ttl">'+ico(ic[b.type]||'clipboard',16,'var(--yellow)')+esc(lb[b.type]||b.type)+extras+'</div>'
    +'<div class="sub">'+esc(b.requester||'')+(b.site&&!runsheet?' · '+esc(b.site):'')+'</div>'+loc+'</div>'
    +badge+'</div>'
    +'<div class="desc">'+esc(desc)+'</div>'
    +'<div class="when">'+ico(runsheet?'clock':'calendar',13,'currentColor')+when+'</div></div>';
}

/* ---- calendar ---- */
function calShiftMonth(delta){
  calDate=new Date(calDate.getFullYear(), calDate.getMonth()+delta, 1);
  renderCalendar();
}
function calGoToday(){ calDate=new Date(); renderCalendar(); }

function calDotColor(b){
  if(b.status==='declined') return 'var(--faint)';
  if(b.priority==='urgent') return 'var(--red)';
  if(b.status==='completed') return 'var(--blue)';
  if(b.status==='approved'||b.status==='in-progress') return 'var(--green)';
  return 'var(--amber)'; // pending
}

function renderCalendar(){
  var label=el('calMonthLabel'); if(!label) return;
  var year=calDate.getFullYear(), month=calDate.getMonth();
  label.textContent=calDate.toLocaleDateString('en-US',{month:'long',year:'numeric'}).toUpperCase();

  var startWeekday=new Date(year,month,1).getDay();
  var daysInMonth=new Date(year,month+1,0).getDate();
  var daysInPrevMonth=new Date(year,month,0).getDate();

  var byDate={};
  bookings.forEach(function(b){ if(b.date) (byDate[b.date]=byDate[b.date]||[]).push(b); });

  var cells=[];
  for(var i=startWeekday-1;i>=0;i--) cells.push({day:daysInPrevMonth-i, other:true});
  for(var d=1;d<=daysInMonth;d++) cells.push({day:d, other:false, dateObj:new Date(year,month,d)});
  var trailing=(7-(cells.length%7))%7;
  for(var t=1;t<=trailing;t++) cells.push({day:t, other:true});

  var todayISO=today();
  el('calGrid').innerHTML=cells.map(function(c){
    if(c.other) return '<div class="calday other" aria-hidden="true"><div class="dnum">'+c.day+'</div></div>';
    var iso=toISODate(c.dateObj);
    var list=byDate[iso]||[];
    var dots='';
    if(list.length){
      var shown=list.slice(0,4);
      dots='<div class="caldots">'+shown.map(function(b){ return '<span class="caldot" style="background:'+calDotColor(b)+'"></span>'; }).join('')+'</div>';
      if(list.length>4) dots+='<div class="calmore">+'+(list.length-4)+'</div>';
    }
    return '<button type="button" class="calday'+(iso===todayISO?' today':'')+'" aria-label="'+esc(fmtD(iso))+', '+list.length+' booking'+(list.length===1?'':'s')+'" data-action="open-day" data-date="'+iso+'"><span class="dnum">'+c.day+'</span>'+dots+'</button>';
  }).join('');
}

function openDay(iso){
  var list=bookings.filter(function(b){ return b.date===iso; })
    .sort(function(a,b){ return (a.time||'99:99').localeCompare(b.time||'99:99'); });
  var label=new Date(iso+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +'<span style="font-size:18px;font-weight:800">'+esc(label)+'</span>'
    +'<button data-action="close-day" class="closebtn" aria-label="Close">'+ico('x',15)+'</button></div>';
  html+=list.length ? list.map(function(b){ return cardHTML(b,false); }).join('') : emptyState('inbox','No bookings this day');
  html+='<button data-action="new-booking-day" data-date="'+iso+'" class="btn-outline" style="width:100%;margin-top:6px;display:flex;align-items:center;justify-content:center;gap:8px">'+ico('plus',15)+'New Booking This Day</button>';
  el('dayContent').innerHTML=html;
  showOverlay('dayOverlay');
}
function closeDay(){ hideOverlay('dayOverlay'); }

/* ---- detail ---- */
function openDetail(id){
  var b=bookings.find(function(x){ return x.id===id; }); if(!b) return;
  var ic={delivery:'package',pickup:'wrench','tool-delivery':'truck',misc:'file'};
  var lb={delivery:'Material Delivery',pickup:'Tool Pickup','tool-delivery':'Tool Delivery',misc:'Misc Task'};
  var disp=isDispatcher();
  var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-size:18px;font-weight:800;display:flex;align-items:center;gap:9px">'+ico(ic[b.type]||'clipboard',19,'var(--yellow)')+esc(lb[b.type]||b.type)+'</span><button data-action="close-detail" class="closebtn" aria-label="Close">'+ico('x',15)+'</button></div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">'
    +'<div><div class="dl">From</div><div class="dv">'+esc(b.requester||'—')+'</div></div>'
    +'<div><div class="dl">Site</div><div class="dv">'+esc(b.site||'—')+'</div></div>'
    +'<div><div class="dl">Date</div><div class="dv" style="color:var(--yellow)">'+fmtD(b.date)+'</div></div>'
    +'<div><div class="dl">Time</div><div class="dv">'+(b.time?fmtT(b.time):'Not set')+'</div></div></div>';
  if(b.pickupLocation) html+='<div style="margin-bottom:14px"><div class="dl" style="margin-bottom:6px">Pickup Location</div><div class="dbox">'+esc(b.pickupLocation)+'</div></div>';
  html+='<div style="margin-bottom:14px"><div class="dl" style="margin-bottom:6px">Description</div><div class="dbox">'+esc(b.description||'')+'</div></div>';
  if(b.photo) html+='<div style="margin-bottom:14px"><div class="dl" style="margin-bottom:6px">Photo</div><img class="dphoto" src="'+esc(b.photo)+'" alt="Booking photo"/></div>';
  if(b.notes) html+='<div style="margin-bottom:14px"><div class="dl" style="margin-bottom:6px">Notes</div><div class="dbox">'+esc(b.notes)+'</div></div>';
  if(b.brentNotes) html+='<div style="margin-bottom:14px"><div class="dl" style="margin-bottom:6px">Brent\'s Notes</div><div class="dbox" style="color:var(--yellow);border-color:rgba(245,197,24,0.25)">'+esc(b.brentNotes)+'</div></div>';
  html+='<hr/>';

  var canEdit=!b._queued&&(disp||b.canEdit===true);
  if(b._queued){
    html+='<div class="queue-alert" role="status">'+(b._queueBlocked?'This booking could not sync. Discard it and submit again after correcting the issue.':'This booking is stored safely on this device and will sync when the connection returns.')+'</div>';
    if(b._queueBlocked) html+='<button data-action="discard-queued" data-booking-id="'+esc(b.id)+'" class="btn-outline" style="width:100%">Discard Local Booking</button>';
  } else if(disp){
    if(b.status==='pending'){
      html+='<textarea id="dNotes" class="field" placeholder="Brent\'s notes (optional)..." style="margin-bottom:12px"></textarea>';
      html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button data-action="set-status" data-booking-id="'+esc(b.id)+'" data-status="approved" class="btn-green">'+ico('check',16)+'Approve</button><button data-action="set-status" data-booking-id="'+esc(b.id)+'" data-status="declined" class="btn-red">'+ico('x',16)+'Decline</button></div>';
    } else if(b.status==='approved'){
      html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button data-action="set-status" data-booking-id="'+esc(b.id)+'" data-status="in-progress" class="btn-primary" style="display:flex;align-items:center;justify-content:center;gap:8px">'+ico('play',15)+'Start Job</button><button data-action="set-status" data-booking-id="'+esc(b.id)+'" data-status="declined" class="btn-outline">Cancel</button></div>';
    } else if(b.status==='in-progress'){
      html+='<button data-action="set-status" data-booking-id="'+esc(b.id)+'" data-status="completed" class="btn-green" style="width:100%">'+ico('checkcircle',16)+'Mark Complete</button>';
    }
  } else if(b.status==='pending'){
    html+='<div style="text-align:center;color:var(--faint);font-size:12px;padding:4px 0 8px;font-family:\'JetBrains Mono\',monospace;letter-spacing:0.08em">AWAITING DISPATCHER APPROVAL</div>';
  }
  if(canEdit){
    html+='<button data-action="edit-booking" data-booking-id="'+esc(b.id)+'" class="btn-outline" style="width:100%;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px">'+ico('edit',15)+'Edit Booking</button>';
  }
  if(disp){
    html+='<button data-action="delete-booking" data-booking-id="'+esc(b.id)+'" style="background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;width:100%;padding:12px;margin-top:8px;font-family:inherit;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px">'+ico('trash',15)+'Delete Booking</button>';
  }
  el('detailContent').innerHTML=html;
  showOverlay('detailOverlay');
}

async function doStatus(id,status){
  var b=bookings.find(function(x){ return x.id===id; }); if(!b) return;
  var n=el('dNotes'); var notes=n?n.value:'';
  var payload={status:status,brentNotes:notes,version:b.version};
  var msgs={approved:'Approved',declined:'Declined','in-progress':'Job started',completed:'Marked complete'};
  try{
    var updated=await apiCall('PUT','/bookings/'+id,payload,msgs[status]||'Updated');
    if(updated&&!updated._queued) Object.assign(b,updated);
    else { b.status=status; b._queued=true; }
    closeDetail(); renderAll();
  }catch(error){ if(error.status===409) await loadData(); }
}

async function doDelete(id){
  if(!confirm('Delete this booking?')) return;
  try{
    await apiCall('DELETE','/bookings/'+id,null,'Booking deleted');
    bookings=bookings.filter(function(b){ return b.id!==id; });
    closeDetail(); renderAll();
  }catch(error){}
}

/* ---- photo ---- */
function handlePhoto(input){
  var f=input.files&&input.files[0]; if(!f) return;
  if(!/^image\/(jpeg|png|webp)$/.test(f.type)){ toast('Use a JPEG, PNG, or WebP photo','err'); input.value=''; return; }
  var reader=new FileReader();
  reader.onload=function(e){
    var img=new Image();
    img.onload=function(){
      var max=1600, w=img.width, h=img.height;
      if(w>max||h>max){ var r=Math.min(max/w,max/h); w=Math.round(w*r); h=Math.round(h*r); }
      var c=document.createElement('canvas'); c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      c.toBlob(function(blob){
        if(!blob||blob.size>5*1024*1024){ toast('Photo is larger than 5MB after compression','err'); return; }
        if(curPhotoPreviewUrl) URL.revokeObjectURL(curPhotoPreviewUrl);
        curPhotoFile=new File([blob],'dispatch-'+Date.now()+'.jpg',{type:'image/jpeg'});
        curPhotoPreviewUrl=URL.createObjectURL(curPhotoFile);
        curPhoto=curPhotoPreviewUrl;
        renderPhotoPrev();
      },'image/jpeg',0.82);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(f);
  input.value='';
}
function renderPhotoPrev(){
  var p=el('photoPrev');
  if(curPhoto){
    p.innerHTML='<div class="photoprev"><img src="'+curPhoto+'" alt="Attached photo"/><button data-action="remove-photo" aria-label="Remove photo">'+ico('x',14)+'</button></div>';
    el('photoBtn').classList.add('hidden');
  } else {
    p.innerHTML='';
    el('photoBtn').classList.remove('hidden');
  }
}
function removePhoto(){
  if(curPhotoPreviewUrl) URL.revokeObjectURL(curPhotoPreviewUrl);
  curPhotoPreviewUrl=null; curPhotoFile=null; curPhoto=null; renderPhotoPrev();
}

/* ---- cost estimate ---- */
function estimateDispatch(){
  var name=currentSiteName();
  var rec=sites.find(function(s){ return s.name===name; });
  var result=dispatchBreakdown(curType,rec);
  return {min:result.minutes,km:result.km,labor:result.labor,mileage:result.mileage,cost:result.cost};
}

function renderCostEstimateBox(est){
  var box=el('costEstimate'); if(!box) return;
  var flag=est.cost>=LOW_VALUE_THRESHOLD && curPri==='normal';
  var canBundle=flag&&Boolean(currentSiteName());
  var html='<div style="display:flex;align-items:center;gap:10px">'
    +ico('dollarsign',18,flag?'var(--amber)':'var(--dim)')
    +'<div style="flex:1"><div class="dl" style="margin-bottom:2px">Estimated Dispatch Cost</div>'
    +'<div class="mono" style="font-size:20px;font-weight:800;color:'+(flag?'var(--amber)':'var(--text)')+'">$'+est.cost.toFixed(0)+'</div></div>'
    +'<div class="mono" style="text-align:right;font-size:11px;color:var(--faint)">'+Math.round(est.min)+' min<br>'+est.km.toFixed(0)+' km</div>'
    +'</div>'
    +'<div style="font-size:10px;color:var(--faint);margin-top:8px">Typical route estimate. The server recalculates and stores the final estimate.</div>';
  if(flag){
    html+='<div style="font-size:12px;color:var(--dim);line-height:1.5;padding-top:10px;margin-top:10px;border-top:1px solid var(--border-soft)">'
      +'Labor $'+est.labor.toFixed(0)+' + mileage $'+est.mileage.toFixed(0)+'. If this can wait, bundling it into Brent\'s next run to this site skips the dedicated trip.'
      +'</div>';
    if(canBundle) html+='<button type="button" data-action="bundle" class="btn-outline" style="width:100%;margin-top:10px;padding:11px;font-size:13px">Queue for Next Run Instead</button>';
  }
  box.innerHTML=html;
  box.style.borderColor=flag?'rgba(245,158,11,0.4)':'var(--border-soft)';
}

function renderCostEstimate(){
  renderCostEstimateBox(estimateDispatch());
}

function bundleInstead(){
  bundleRequested=true;
  setPri('scheduled');
  toast('This request will be matched to the next run for this site','ok');
}

/* ---- form ---- */
function setType(t){
  curType=t;
  ['delivery','pickup','tool-delivery','misc'].forEach(function(x){
    var btn=el('t-'+x); if(!btn) return;
    btn.className='seg'+(x===t?' on':'');
  });
  el('fPickupWrap').className=(t==='pickup'||t==='tool-delivery')?'':'hidden';
  if(!editId){
    var titles={delivery:'Material Delivery',pickup:'Tool Pickup','tool-delivery':'Tool Delivery',misc:'Misc Task'};
    el('fTitle').textContent=titles[t]||'New Booking';
  }
  renderCostEstimate();
}
function setPri(p){
  curPri=p;
  ['urgent','normal','scheduled'].forEach(function(x){
    var btn=el('p-'+x); if(!btn) return;
    btn.className='seg'+(x===p?' on':'');
  });
  renderCostEstimate();
}

function openForm(type){
  editId=null; curType=type||'delivery'; curPri='normal'; removePhoto(); bundleRequested=false;
  var titles={delivery:'Material Delivery',pickup:'Tool Pickup','tool-delivery':'Tool Delivery',misc:'Misc Task'};
  el('fTitle').textContent=titles[type]||'New Booking';
  el('fWho').value=currentUser?currentUser.name:''; el('fWho').readOnly=true; el('fDesc').value=''; el('fNotes').value='';
  if(el('fPickup')) el('fPickup').value='';
  if(el('fTime')) el('fTime').value='';
  el('fDate').min=today(); el('fDate').value=today(); setSiteField('');
  el('fSubmit').textContent='Submit Booking Request';
  setType(curType); setPri('normal'); renderPhotoPrev(); renderCostEstimate();
  showOverlay('formOverlay');
}

function startEdit(id){
  var b=bookings.find(function(x){ return x.id===id; }); if(!b) return;
  closeDetail();
  editId=id; curType=b.type||'delivery'; curPri=b.priority||'normal';
  if(curPhotoPreviewUrl) URL.revokeObjectURL(curPhotoPreviewUrl);
  curPhotoPreviewUrl=null; curPhotoFile=null; curPhoto=b.photo||null; bundleRequested=b.bundleRequested===true;
  el('fTitle').textContent='Edit Booking';
  el('fWho').value=b.requester||''; el('fWho').readOnly=true;
  setSiteField(b.site||'');
  el('fDesc').value=b.description||'';
  el('fDate').min=''; el('fDate').value=b.date||today();
  el('fTime').value=b.time||'';
  el('fNotes').value=b.notes||'';
  if(el('fPickup')) el('fPickup').value=b.pickupLocation||'';
  el('fSubmit').textContent='Save Changes';
  setType(curType); setPri(curPri); renderPhotoPrev(); renderCostEstimate();
  showOverlay('formOverlay');
}

function closeForm(){ hideOverlay('formOverlay'); }
function closeDetail(){ hideOverlay('detailOverlay'); }

async function submitBooking(){
  var desc=el('fDesc').value.trim();
  var date=el('fDate').value;
  var siteName=currentSiteName();
  var pickup=el('fPickup').value.trim();
  if(!desc||!date){ toast('Description and date are required','err'); return; }
  if((curType==='delivery'||curType==='tool-delivery')&&!siteName){ toast('Select or enter a job site','err'); return; }
  if((curType==='pickup'||curType==='tool-delivery')&&!pickup){ toast('Enter the pickup location','err'); return; }
  if(el('fSite').value==='__other__'&&!siteName){ alert('Enter the job site name.'); return; }
  var btn=el('fSubmit');
  var editing=!!editId;
  btn.textContent=editing?'Saving...':'Submitting...'; btn.disabled=true;

  var fields={type:curType,site:siteName,description:desc,date:date,time:el('fTime').value,priority:curPri,notes:el('fNotes').value,pickupLocation:pickup,bundleRequested:bundleRequested};

  try{
    if(editing){
      var b=bookings.find(function(x){ return x.id===editId; });
      if(!b) throw new Error('Booking no longer exists');
      fields.version=b.version;
      fields.photoId=curPhoto?b.photoId:null;
      var updated=await apiCall('PUT','/bookings/'+editId,fields,'Booking updated',{photoFile:curPhotoFile});
      if(updated&&!updated._queued) Object.assign(b,updated);
      else { Object.assign(b,fields); b._queued=true; }
    }else{
      var actionId=uid();
      var saved=await apiCall('POST','/bookings',fields,'Booking submitted',{idempotencyKey:actionId,tempId:actionId,photoFile:curPhotoFile});
      if(saved&&saved.id) bookings.push(saved);
      else bookings.push(Object.assign({id:actionId,version:1,status:'pending',requester:currentUser.name,createdAt:new Date().toISOString(),_queued:true},fields));
    }
    closeForm(); editId=null; renderAll();
  }catch(error){ if(error.status===409) await loadData(); }
  finally{ btn.textContent=editing?'Save Changes':'Submit Booking Request'; btn.disabled=false; }
}

function showPage(p){
  ['home','bookings','brent','calendar','manager'].forEach(function(x){
    var pg=el('pg-'+x); var nb=el('nb-'+x);
    if(pg) pg.className='page'+(x===p?'':' hidden');
    if(nb) nb.className='nb'+(x===p?' on':'');
  });
  window.scrollTo(0,0);
  if(p==='calendar') renderCalendar();
  if(p==='manager') renderManagerView();
}

function renderManagerView(){
  var locked=el('managerLocked'), unlocked=el('managerUnlocked');
  if(!locked||!unlocked) return;
  if(isManager()){
    locked.className='hidden'; unlocked.className='';
    if(!el('mgrFrom').value){
      var toD=new Date(), fromD=new Date(); fromD.setDate(fromD.getDate()-30);
      el('mgrFrom').value=toISODate(fromD);
      el('mgrTo').value=toISODate(toD);
    }
    renderManagerSummary();
  } else {
    locked.className=''; unlocked.className='hidden';
  }
}

async function renderManagerSummary(){
  var fromV=el('mgrFrom').value, toV=el('mgrTo').value;
  if(!isManager()) return;
  el('mgrTotalCard').innerHTML='<div class="skel"></div>';
  var summary;
  try{ summary=await apiRequest('GET','/manager-summary?from='+encodeURIComponent(fromV)+'&to='+encodeURIComponent(toV)); }
  catch(error){ el('mgrTotalCard').innerHTML=emptyState('alert','Summary could not be loaded'); return; }

  el('mgrTotalCard').innerHTML=
    '<div class="card" style="display:flex;justify-content:space-between;gap:10px;text-align:center">'
    +'<div style="flex:1"><div class="dl">Bookings</div><div class="mono" style="font-size:22px;font-weight:800">'+summary.bookings+'</div></div>'
    +'<div style="flex:1"><div class="dl">Est. Cost</div><div class="mono" style="font-size:22px;font-weight:800;color:var(--amber)">$'+Math.round(summary.cost)+'</div></div>'
    +'<div style="flex:1"><div class="dl">Declined</div><div class="mono" style="font-size:22px;font-weight:800;color:var(--faint)">'+summary.declined+'</div></div>'
    +'</div>';
  el('mgrSiteList').innerHTML=summary.bySite.length ? summary.bySite.map(function(r){
    return '<div class="bcard" style="--bc:var(--amber);cursor:default">'
      +'<div class="row"><div><div class="ttl" style="font-size:15px">'+esc(r.name)+'</div>'
      +'<div class="sub">'+r.count+' booking'+(r.count!==1?'s':'')+(r.declined?' · '+r.declined+' declined':'')+'</div></div>'
      +'<div class="mono" style="font-size:18px;font-weight:800;color:var(--amber)">$'+Math.round(r.cost)+'</div></div>'
      +'</div>';
  }).join('') : emptyState('inbox','No bookings in this range');
}

async function loadUsers(){
  var list=el('mgrUserList'); if(!list||!isManager()) return;
  try{
    var users=await apiRequest('GET','/admin/users');
    list.innerHTML=users.length?users.map(function(user){
      var own=user.id===currentUser.id;
      return '<div class="bcard" style="--bc:var(--violet);cursor:default"><div class="row" style="margin-bottom:0"><div style="min-width:0"><div class="ttl" style="font-size:14px">'+esc(user.name)+'</div><div class="sub" style="overflow-wrap:anywhere">'+esc(user.email)+'</div></div>'
        +'<div style="display:flex;align-items:center;gap:6px"><label class="sr-only" for="role-'+esc(user.id)+'">Role for '+esc(user.name)+'</label><select id="role-'+esc(user.id)+'" class="field user-role" data-user-role="'+esc(user.id)+'" '+(own?'disabled':'')+'>'
        +['member','dispatcher','manager'].map(function(role){ return '<option value="'+role+'" '+(user.role===role?'selected':'')+'>'+role.charAt(0).toUpperCase()+role.slice(1)+'</option>'; }).join('')
        +'</select>'+(own?'':'<button type="button" class="iconbtn" data-action="save-role" data-user-id="'+esc(user.id)+'" aria-label="Save role">'+ico('check',15)+'</button>')+'</div></div></div>';
    }).join(''):emptyState('inbox','No Identity users found');
  }catch(error){ list.innerHTML=emptyState('alert','User access could not be loaded'); }
}

async function saveUserRole(id){
  var select=document.querySelector('[data-user-role="'+CSS.escape(id)+'"]'); if(!select) return;
  try{
    await apiCall('PUT','/admin/users/'+encodeURIComponent(id),{role:select.value},null,{queue:false,idempotencyKey:uid()});
    toast('Access updated — that user should sign out and back in','ok');
    await loadUsers();
  }catch(error){}
}

async function startAuthenticated(){
  currentUser=await apiRequest('GET','/me');
  authCallback=null;
  el('authGate').classList.add('hidden');
  el('appShell').classList.remove('hidden');
  setAuthMessage('');
  renderLock();
  renderManagerView();
  await loadUsers();
  await loadSites();
  await flushQueue();
  await loadData();
}

function closeTopOverlay(){
  if(el('detailOverlay').classList.contains('show')) return closeDetail();
  if(el('siteFormOverlay').classList.contains('show')) return closeSiteForm();
  if(el('dayOverlay').classList.contains('show')) return closeDay();
  if(el('formOverlay').classList.contains('show')) return closeForm();
}

document.addEventListener('keydown',function(event){
  if(event.target.id==='sfAddress'&&event.key==='ArrowDown'&&!el('sfAddressResults').classList.contains('hidden')){
    var first=el('sfAddressResults').querySelector('button'); if(first){ event.preventDefault(); first.focus(); } return;
  }
  if(event.target.id==='sfAddress'&&event.key==='Escape'&&!el('sfAddressResults').classList.contains('hidden')){
    event.preventDefault(); hideAddressSuggestions(); return;
  }
  if(event.key==='Escape') return closeTopOverlay();
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"][data-action]')){
    event.preventDefault(); event.target.click(); return;
  }
  if(event.key!=='Tab') return;
  var overlays=Array.from(document.querySelectorAll('.overlay.show'));
  var top=overlays[overlays.length-1]; if(!top) return;
  var focusable=Array.from(top.querySelectorAll('button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
  if(!focusable.length) return;
  var first=focusable[0], last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){ event.preventDefault(); last.focus(); }
  else if(!event.shiftKey&&document.activeElement===last){ event.preventDefault(); first.focus(); }
});
document.querySelectorAll('.overlay').forEach(function(overlay){
  overlay.addEventListener('click',function(event){ if(event.target===overlay) closeTopOverlay(); });
});

el('authForm').addEventListener('submit',submitAuth);
document.addEventListener('change',function(event){
  if(event.target.id==='fSite') onSiteChange();
  else if(event.target.id==='fPhoto') handlePhoto(event.target);
  else if(event.target.id==='mgrFrom'||event.target.id==='mgrTo') renderManagerSummary();
});
document.addEventListener('input',function(event){
  if(event.target.id==='fSiteOther') renderCostEstimate();
  else if(event.target.id==='sfAddress') onSiteAddressInput();
});
document.addEventListener('click',function(event){
  var target=event.target.closest('[data-action]'); if(!target) return;
  var action=target.dataset.action;
  if(action==='toggle-auth-mode') toggleAuthMode();
  else if(action==='forgot-password') forgotPassword();
  else if(action==='sign-out') signOut();
  else if(action==='refresh') manualRefresh();
  else if(action==='open-form') openForm(target.dataset.type);
  else if(action==='open-site') openSiteForm(target.dataset.siteIndex===undefined?undefined:Number(target.dataset.siteIndex));
  else if(action==='shift-month') calShiftMonth(Number(target.dataset.delta));
  else if(action==='calendar-today') calGoToday();
  else if(action==='show-page') showPage(target.dataset.page);
  else if(action==='close-form') closeForm();
  else if(action==='set-type') setType(target.dataset.type);
  else if(action==='set-priority') setPri(target.dataset.priority);
  else if(action==='choose-photo') el('fPhoto').click();
  else if(action==='submit-booking') submitBooking();
  else if(action==='close-site') closeSiteForm();
  else if(action==='save-site') saveSite();
  else if(action==='choose-site-address') chooseSiteAddress(Number(target.dataset.addressIndex));
  else if(action==='delete-site') deleteSite();
  else if(action==='save-role') saveUserRole(target.dataset.userId);
  else if(action==='clear-blocked') clearBlockedQueue();
  else if(action==='open-detail') openDetail(target.dataset.bookingId);
  else if(action==='open-day') openDay(target.dataset.date);
  else if(action==='close-day') closeDay();
  else if(action==='new-booking-day'){ closeDay(); openForm('delivery'); el('fDate').value=target.dataset.date; }
  else if(action==='close-detail') closeDetail();
  else if(action==='discard-queued') discardQueued(target.dataset.bookingId);
  else if(action==='set-status') doStatus(target.dataset.bookingId,target.dataset.status);
  else if(action==='edit-booking') startEdit(target.dataset.bookingId);
  else if(action==='delete-booking') doDelete(target.dataset.bookingId);
  else if(action==='remove-photo') removePhoto();
  else if(action==='bundle') bundleInstead();
});

// Global error catcher
window.onerror = function(msg, src, line){
  var bt = document.getElementById('brentTxt');
  if(bt){ bt.textContent = 'ERROR: '+msg+' (line '+line+')'; bt.style.color = 'var(--red)'; }
  return false;
};

async function init(){
  el('authLogo').innerHTML=ico('truck',22,'#0d0d0f');
  el('logoIc').innerHTML=ico('truck',19,'#0d0d0f');
  el('brentIc').innerHTML=ico('hardhat',24,'#0d0d0f');
  el('refreshIc').innerHTML=ico('refresh',16);
  hydrateIcons(document);
  el('todayTxt').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}).toUpperCase();
  loadSignupAvailability();
  try{
    authCallback=await handleAuthCallback();
    if(authCallback&&authCallback.type==='invite'){
      setAuthMode('invite');
      setAuthMessage('Create a password with at least 8 characters.');
      return;
    }
    if(authCallback&&authCallback.type==='recovery'){
      setAuthMode('recovery');
      setAuthMessage('Choose a new password with at least 8 characters.');
      return;
    }
    var identityUser=(authCallback&&authCallback.user)||await getUser();
    if(identityUser) await startAuthenticated();
  }catch(error){
    setAuthMessage(error.message||'Authentication could not be initialized.','err');
  }
}

window.addEventListener('online',function(){ if(currentUser) flushQueue().then(function(synced){ if(synced) loadData(); }); });
init();
