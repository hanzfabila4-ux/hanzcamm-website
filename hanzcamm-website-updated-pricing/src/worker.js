const STAGES = ['Agreement of deliverables', 'Shooting', 'Editing', 'Approval of deliverables', 'Completion'];
const enc = new TextEncoder();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...headers }});
const fail = (message, status = 400) => json({ error: message }, status);
const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('');
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name:'PBKDF2', salt:enc.encode(salt), iterations:210000, hash:'SHA-256' }, key, 256));
}
async function hashPassword(password) { const salt = randomToken(); return salt + ':' + await derive(password, salt); }
async function verifyPassword(password, stored) { if (!stored?.includes(':')) return false; const [salt, correct] = stored.split(':'); const actual = await derive(password,salt); return actual.length === correct.length && actual === correct; }
const id = () => crypto.randomUUID();
const cookie = (token, request, maxAge) => `hanz_session=${token}; HttpOnly; ${new URL(request.url).protocol === 'https:' ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
async function auth(request, db) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)hanz_session=([a-f0-9]{64})/)?.[1];
  if (!token) return null;
  const tokenHash = await sha(token);
  return db.prepare('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash,Date.now()).first();
}
async function input(request) { try { return await request.json(); } catch { return {}; } }
const validEmail = s => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 255;
const clean = (s,n=300) => typeof s === 'string' ? s.trim().slice(0,n) : '';
const isAdmin = user => user?.role === 'admin';
async function projectAllowed(db, projectId, user) {
  if (isAdmin(user)) return true;
  if (user.role === 'client') return !!(await db.prepare('SELECT id FROM projects WHERE id=? AND client_id=?').bind(projectId,user.id).first());
  return !!(await db.prepare('SELECT project_id FROM project_team WHERE project_id=? AND user_id=?').bind(projectId,user.id).first());
}
const forbidden = () => fail('You do not have access to this resource.',403);
const stages = STAGES;
export default {
 async fetch(request, env) {
  const url = new URL(request.url); const path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (!env.DB) return fail('Database binding not configured.',503);
  if (!['GET','POST','PATCH','DELETE'].includes(request.method)) return fail('Method not allowed',405);
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return forbidden();
  }
  try {
   if (path === '/api/health' && request.method === 'GET') return json({ok:true});
   if (path === '/api/enquiries' && request.method === 'POST') {
     const b = await input(request);
     const name = clean(b.name,100), email=clean(b.email,254).toLowerCase(), service=clean(b.service,100), message=clean(b.message,2000), date=clean(b.event_date,40);
     if (!name || !validEmail(email) || !service || message.length < 10) return fail('Enter your name, valid email, service and a message of at least 10 characters.');
     if (clean(b.website)) return json({ok:true}); // honeypot
     await env.DB.prepare('INSERT INTO enquiries (id,name,email,service,event_date,message) VALUES (?,?,?,?,?,?)').bind(id(),name,email,service,date,message).run();
     return json({ok:true, message:'Enquiry received. HanzCamm will be in touch.'},201);
   }
   if (path === '/api/setup' && request.method === 'POST') {
     if (!env.ADMIN_SETUP_TOKEN || env.ADMIN_SETUP_TOKEN.length < 24) return fail('Set ADMIN_SETUP_TOKEN as a Cloudflare secret first.',503);
     const already = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
     if (already) return fail('Initial setup has already been completed.',409);
     const b = await input(request);
     if (b.token !== env.ADMIN_SETUP_TOKEN) return forbidden();
     if (!validEmail(b.email) || typeof b.password !== 'string' || b.password.length < 12) return fail('Provide a valid email and password of at least 12 characters.');
     await env.DB.prepare('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)').bind(id(),clean(b.name,100)||'HanzCamm',b.email.toLowerCase(),await hashPassword(b.password),'admin').run();
     return json({ok:true});
   }
   if (path === '/api/login' && request.method === 'POST') {
     const b = await input(request), email = clean(b.email,254).toLowerCase();
     const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
     if (!user || typeof b.password !== 'string' || !(await verifyPassword(b.password,user.password_hash))) return fail('Incorrect email or password.',401);
     const token=randomToken();
     await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha(token),user.id,Date.now()+7*86400000).run();
     return json({ok:true,role:user.role},200, {'set-cookie':cookie(token,request,7*86400)});
   }
   const user = await auth(request,env.DB);
   if (path === '/api/me' && request.method === 'GET') return json({user:user || null, stages});
   if (path === '/api/logout' && request.method === 'POST') {
     const token=request.headers.get('cookie')?.match(/(?:^|;\s*)hanz_session=([a-f0-9]{64})/)?.[1];
     if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();
     return json({ok:true},200,{'set-cookie':cookie('',request,0)});
   }
   if (!user) return fail('Please log in.',401);
   if (path === '/api/enquiries' && request.method === 'GET') {
     if (!isAdmin(user)) return forbidden();
     return json({enquiries:(await env.DB.prepare('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 100').all()).results});
   }
   if (path === '/api/users' && request.method === 'GET') {
     if (!isAdmin(user)) return forbidden();
     return json({users:(await env.DB.prepare('SELECT id,name,email,role FROM users ORDER BY created_at DESC').all()).results});
   }
   if (path === '/api/users' && request.method === 'POST') {
     if (!isAdmin(user)) return forbidden();
     const b=await input(request), role=clean(b.role), email=clean(b.email,254).toLowerCase();
     if (!['client','collaborator'].includes(role) || !validEmail(email) || typeof b.password !== 'string' || b.password.length < 12) return fail('Valid email, role and a password of at least 12 characters required.');
     const uid=id();
     await env.DB.prepare('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)').bind(uid,clean(b.name,100)||email,email,await hashPassword(b.password),role).run();
     return json({ok:true,id:uid},201);
   }
   if (path === '/api/projects' && request.method === 'GET') {
     const sql=isAdmin(user) ? 'SELECT p.*,u.name AS client_name FROM projects p JOIN users u ON u.id=p.client_id ORDER BY p.created_at DESC' : user.role === 'client' ? 'SELECT p.*,u.name AS client_name FROM projects p JOIN users u ON u.id=p.client_id WHERE p.client_id=? ORDER BY p.created_at DESC' : 'SELECT p.*,u.name AS client_name FROM projects p JOIN users u ON u.id=p.client_id JOIN project_team t ON t.project_id=p.id WHERE t.user_id=? ORDER BY p.created_at DESC';
     const projects=(await (isAdmin(user)? env.DB.prepare(sql): env.DB.prepare(sql).bind(user.id)).all()).results;
     return json({projects});
   }
   if (path === '/api/projects' && request.method === 'POST') {
     if (!isAdmin(user)) return forbidden();
     const b=await input(request), pid=id(), title=clean(b.title,180), client=clean(b.client_id,64);
     if (!title || !client) return fail('Project title and client are required.');
     const exists=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='client'").bind(client).first();
     if (!exists) return fail('Select an existing client.');
     await env.DB.prepare('INSERT INTO projects (id,client_id,title,service,event_date,price_gbp,notes) VALUES (?,?,?,?,?,?,?)').bind(pid,client,title,clean(b.service,100)||'Photography',clean(b.event_date,40),Number.isInteger(Number(b.price_gbp))? Number(b.price_gbp):null,clean(b.notes,2000)).run();
     return json({ok:true,id:pid},201);
   }
   const match=path.match(/^\/api\/projects\/([0-9a-f-]{36})(?:\/(tasks|files|approvals|team))?$/);
   if (match) {
     const pid=match[1], section=match[2];
     if (!(await projectAllowed(env.DB,pid,user))) return forbidden();
     if (!section && request.method==='GET') {
       const project=await env.DB.prepare('SELECT p.*,u.name AS client_name FROM projects p JOIN users u ON u.id=p.client_id WHERE p.id=?').bind(pid).first();
       const tasks= (await env.DB.prepare('SELECT id,title,done FROM tasks WHERE project_id=? ORDER BY created_at').bind(pid).all()).results;
       const files= (await env.DB.prepare('SELECT id,original_name,byte_size,is_final,created_at FROM files WHERE project_id=? ORDER BY created_at DESC').bind(pid).all()).results;
       const approvals=(await env.DB.prepare('SELECT a.status,a.comment,a.created_at,u.name FROM approvals a JOIN users u ON a.client_id=u.id WHERE a.project_id=? ORDER BY a.created_at DESC').bind(pid).all()).results;
       return json({project, tasks:isAdmin(user)||user.role==='collaborator'?tasks:[],files,approvals});
     }
     if (!section && request.method==='PATCH') {
       if (!isAdmin(user)) return forbidden();
       const b=await input(request), stage=Number(b.stage);
       if (!Number.isInteger(stage) || stage<0 || stage>4) return fail('Invalid stage');
       await env.DB.prepare('UPDATE projects SET stage=? WHERE id=?').bind(stage,pid).run();
       return json({ok:true});
     }
     if (section==='tasks' && request.method==='POST') {
       if (user.role==='client') return forbidden();
       const b=await input(request),title=clean(b.title,250);
       if(!title) return fail('Enter a task title.');
       await env.DB.prepare('INSERT INTO tasks(id,project_id,title) VALUES(?,?,?)').bind(id(),pid,title).run();
       return json({ok:true},201);
     }
     if (section==='tasks' && request.method==='PATCH') {
       if (user.role==='client') return forbidden();
       const b=await input(request);
       await env.DB.prepare('UPDATE tasks SET done=? WHERE id=? AND project_id=?').bind(b.done?1:0,clean(b.id,64),pid).run();
       return json({ok:true});
     }
     if (section==='team' && request.method==='POST') {
       if (!isAdmin(user)) return forbidden();
       const b=await input(request), uid=clean(b.user_id,64);
       const member=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='collaborator'").bind(uid).first();
       if (!member) return fail('Choose a collaborator.');
       await env.DB.prepare('INSERT OR IGNORE INTO project_team(project_id,user_id) VALUES (?,?)').bind(pid,uid).run();
       return json({ok:true});
     }
     if (section==='approvals' && request.method==='POST') {
       if (user.role!=='client') return forbidden();
       const b=await input(request),status=clean(b.status);
       if (!['approved','changes_requested'].includes(status)) return fail('Invalid approval');
       await env.DB.prepare('INSERT INTO approvals(id,project_id,client_id,status,comment) VALUES(?,?,?,?,?)').bind(id(),pid,user.id,status,clean(b.comment,1000)).run();
       return json({ok:true},201);
     }
     if (section==='files' && request.method==='POST') {
       if (user.role==='client') return forbidden();
       if (!env.DELIVERABLES) return fail('R2 bucket binding missing.',503);
       const form=await request.formData(), file=form.get('file');
       if (!file || typeof file==='string') return fail('Choose a file.');
       if (file.size>75*1024*1024) return fail('For large video files, a multipart upload implementation is required. Maximum direct upload: 75MB.',413);
       const fid=id(), key=`projects/${pid}/${fid}`, filename=clean(file.name,255)||'deliverable', type=clean(file.type,100)||'application/octet-stream';
       await env.DELIVERABLES.put(key,file.stream(),{httpMetadata:{contentType:type}});
       await env.DB.prepare('INSERT INTO files(id,project_id,object_key,original_name,content_type,byte_size,is_final) VALUES(?,?,?,?,?,?,?)').bind(fid,pid,key,filename,type,file.size,form.get('is_final')==='true'?1:0).run();
       return json({ok:true},201);
     }
   }
   const download=path.match(/^\/api\/files\/([0-9a-f-]{36})$/);
   if (download && request.method==='GET') {
     const file=await env.DB.prepare('SELECT * FROM files WHERE id=?').bind(download[1]).first();
     if (!file || !(await projectAllowed(env.DB,file.project_id,user))) return forbidden();
     if (!env.DELIVERABLES) return fail('R2 binding not configured',503);
     const object=await env.DELIVERABLES.get(file.object_key);
     if (!object) return fail('File not found.',404);
     return new Response(object.body,{headers:{'content-type':file.content_type,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
   }
   return fail('Not found',404);
  } catch (e) { console.error(e); return fail('Server error. Check your Cloudflare logs and database migrations.',500); }
 }
};
