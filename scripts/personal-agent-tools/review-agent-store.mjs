import { ReviewStore } from './review-store.mjs'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, lstat, readFile, readdir, rename, link, unlink, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
const hash = text => createHash('sha256').update(text).digest('hex')
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(value)
const secret = text => /sk-[a-z0-9]{16,}|-----BEGIN .*PRIVATE KEY|(?:password|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+/i.test(text)
export const REVIEW_AGENT_TOOLS = {
 memory_search: 'query: search existing durable notes before adding duplicates',
 memory_read: 'id: read one note',
 memory_add: 'text, evidence:[{id,quote}]: add a grounded durable note; no deletion or overwrite',
 skill_list: 'list existing skills; prefer improving an existing relevant skill',
 skill_read: 'name: read SKILL.md before changing it',
 skill_create: 'name, description, instructions, evidence:[{id,quote}]: create a class-level skill only when no suitable skill exists',
 skill_patch: 'name, oldText, newText, evidence:[{id,quote}]: replace one exact passage of a skill read during this review',
 finish: 'summary: finish, including when nothing should change',
}
export class ReviewAgentStore {
 constructor(notes, skillsRoot) {
  this.notes=notes;this.skillsRoot=skillsRoot;this.historyStore=new ReviewStore(notes);notes.provenanceDatabase();this.db=notes.database().getDatabaseHandleForEmbeddings()
  this.db.exec(`CREATE TABLE IF NOT EXISTS atomic_review_agent_changes(id INTEGER PRIMARY KEY,run_id INTEGER NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,before_value TEXT,after_value TEXT NOT NULL,phase TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '[]');
   CREATE TABLE IF NOT EXISTS atomic_review_observations(source_key TEXT PRIMARY KEY,session_id TEXT NOT NULL,message_id TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT);
   CREATE TABLE IF NOT EXISTS atomic_review_cursors(session_id TEXT PRIMARY KEY,turns INTEGER NOT NULL DEFAULT 0,work INTEGER NOT NULL DEFAULT 0,last_turn INTEGER NOT NULL DEFAULT 0,last_work INTEGER NOT NULL DEFAULT 0);`)
 }
 observe(input) {
  const key=input.cacheOwner??`${input.sessionId}/${input.messageId}`
  return this.db.transaction(()=>{
   if(this.db.prepare('SELECT 1 FROM atomic_review_observations WHERE source_key=?').get(key))return {duplicate:true}
   this.db.prepare("INSERT INTO atomic_review_observations VALUES(?,?,?,?,?,NULL)").run(key,input.sessionId,input.messageId,Date.now(),'observed')
   const previous=this.db.prepare('SELECT * FROM atomic_review_cursors WHERE session_id=?').get(input.sessionId)??{turns:0,work:0,last_turn:0,last_work:0}
   const turnIndex=Number.isSafeInteger(input.turnCount)&&input.turnCount>0?input.turnCount:previous.last_turn+1
   const workIndex=Number.isSafeInteger(input.workCount)&&input.workCount>=0?input.workCount:previous.last_work+(input.evidence??[]).filter(row=>row.verified).length
   const turns=previous.turns+Math.max(1,turnIndex-previous.last_turn),work=previous.work+Math.max(0,workIndex-previous.last_work)
   const memory=turns>=10,skills=work>=15
   this.db.prepare('INSERT OR REPLACE INTO atomic_review_cursors VALUES(?,?,?,?,?)').run(input.sessionId,turns%10,work%15,turnIndex,workIndex)
   return {key,memory,skills,turnsUntilMemory:memory?10:10-turns,workUntilSkills:skills?15:15-work}
  })()
 }
 mark(input,state,reason=null){this.db.prepare('UPDATE atomic_review_observations SET state=?,reason=? WHERE source_key=?').run(state,reason,input.cacheOwner??`${input.sessionId}/${input.messageId}`)}
 begin(input){
  const source=`agent:${input.sessionId}:${input.messageId}`
  const row=this.db.prepare('SELECT id FROM atomic_review_runs WHERE source_key=?').get(source)
  return row?.id??Number(this.db.prepare("INSERT INTO atomic_review_runs(source_key,session_id,message_id,changes,created_at) VALUES(?,?,?,'[]',?)").run(source,input.sessionId,input.messageId,Date.now()).lastInsertRowid)
 }
 refs(input,refs){
  if(!Array.isArray(refs)||!refs.length||refs.length>8)throw Error('Observed evidence is required')
  const window=new Map(input.evidence.map(row=>[row.id,row]))
  for(const ref of refs){const row=window.get(ref.id);if(!row||typeof ref.quote!=='string'||ref.quote.length<4||ref.quote.length>500||!row.text.includes(ref.quote)||secret(ref.quote)||!(row.role==='user'||row.verified))throw Error('Evidence must quote the user or a successful observed tool result')}
  return refs
 }
 async skillPath(name,existing=true){
  if(!slug(name))throw Error('Invalid skill name')
  await mkdir(this.skillsRoot,{recursive:true,mode:0o700})
  if((await lstat(this.skillsRoot)).isSymbolicLink())throw Error('Linked skill roots are not writable by review')
  const folder=join(this.skillsRoot,name)
  try{const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe skill directory')}catch(error){if(error.code!=='ENOENT'||existing)throw error}
  const path=join(folder,'SKILL.md')
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>100000)throw Error('Unsafe skill file')}catch(error){if(error.code!=='ENOENT'||existing)throw error}
  return path
 }
 skillContent(text,name){
  if(typeof text!=='string'||text.length>100000||secret(text))throw Error('Invalid skill content')
  const match=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text),manifest=match&&parse(match[1])
  if(!manifest||manifest.name!==name||typeof manifest.description!=='string'||!manifest.description.trim()||!match[2].trim())throw Error('Skill requires a valid name, description and instructions')
  return text
 }
 changes(id){return JSON.parse(this.db.prepare('SELECT changes FROM atomic_review_runs WHERE id=?').get(id).changes)}
 record(id,change){const rows=this.changes(id);rows.push(change);this.db.prepare('UPDATE atomic_review_runs SET changes=? WHERE id=?').run(JSON.stringify(rows),id)}
 async tool(input,runId,reads,name,args,signal){
  signal?.throwIfAborted()
  if(!Object.hasOwn(REVIEW_AGENT_TOOLS,name)||!args||typeof args!=='object'||Array.isArray(args))throw Error('Tool is outside the review whitelist')
  if(name==='memory_search')return this.notes.call({action:'search',query:String(args.query??'').slice(0,500)})
  if(name==='memory_read')return this.notes.call({action:'get',id:args.id})
  if(name==='finish')return {complete:true,summary:String(args.summary??'').slice(0,2000),runId,changes:this.changes(runId).length}
  if(name==='skill_list'){
   await mkdir(this.skillsRoot,{recursive:true,mode:0o700});if((await lstat(this.skillsRoot)).isSymbolicLink())throw Error('Linked skill root')
   const result=[];for(const entry of await readdir(this.skillsRoot,{withFileTypes:true}))if(entry.isDirectory()&&slug(entry.name)){try{const path=await this.skillPath(entry.name);const text=await readFile(path,'utf8');const m=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text);const meta=m&&parse(m[1]);result.push({name:entry.name,description:String(meta?.description??'').slice(0,500)})}catch{}}
   return {skills:result}
  }
  if(name==='skill_read'){const path=await this.skillPath(args.name);const text=await readFile(path,'utf8');reads.set(args.name,hash(text));return {name:args.name,content:text,revision:hash(text)}}
  if (name==='memory_add' && input.reviewMemory === false) throw Error('Memory writes are not due in this review')
  if (['skill_create','skill_patch'].includes(name) && input.reviewSkills === false) throw Error('Skill writes are not due in this review')
  const refs=this.refs(input,args.evidence)
  if(name==='memory_add'){
   if(typeof args.text!=='string'||!args.text.trim()||args.text.length>4000||secret(args.text))throw Error('Invalid durable note')
   return this.db.transaction(()=>{
    signal?.throwIfAborted()
    const duplicate=this.db.prepare("SELECT target FROM atomic_review_agent_changes WHERE run_id=? AND kind='note' AND after_value=? AND phase='applied'").get(runId,args.text)
    if(duplicate)return {id:Number(duplicate.target),duplicate:true}
    const existing=this.db.prepare('SELECT id FROM memories WHERE content=?').get(args.text.trim())
    if(existing)return {id:existing.id,duplicate:true}
    const note=this.notes.database().store({content:args.text,tags:['background-review'],source:'agent',sessionId:input.sessionId,workingDir:this.notes.workspace})
    this.db.prepare('INSERT INTO atomic_note_provenance(note_id,source_reference) VALUES(?,?)').run(note.id,`background-review:${runId}; ${input.sessionId}/${input.messageId}`)
    const change=Number(this.db.prepare("INSERT INTO atomic_review_agent_changes(run_id,kind,target,before_value,after_value,phase) VALUES(?,'note',?,NULL,?,'applied')").run(runId,String(note.id),args.text).lastInsertRowid)
    this.record(runId,{id:change,kind:'note',activation:'Durable memory',principle:args.text,evidence:refs,steps:[]});return {id:note.id,saved:true}
   })()
  }
  const path=await this.skillPath(args.name,name==='skill_patch')
  let before=null,after
  if(name==='skill_patch'){
   before=await readFile(path,'utf8');if(reads.get(args.name)!==hash(before))throw Error('Read the current skill before editing; it changed or was not read')
   if(typeof args.oldText!=='string'||!args.oldText||before.split(args.oldText).length!==2||typeof args.newText!=='string')throw Error('Skill patch must replace exactly one existing passage')
   after=this.skillContent(before.replace(args.oldText,args.newText),args.name)
  }else{
   try{await lstat(path);throw Error('Skill already exists; read and patch it')}catch(error){if(error.code!=='ENOENT')throw error}
   if(typeof args.description!=='string'||typeof args.instructions!=='string')throw Error('Skill description and instructions are required')
   after=this.skillContent(`---\n${stringify({name:args.name,description:args.description,version:'0.0.0'})}---\n${args.instructions}\n`,args.name)
  }
  signal?.throwIfAborted();await mkdir(join(this.skillsRoot,args.name),{recursive:true,mode:0o700})
  const change=Number(this.db.prepare("INSERT INTO atomic_review_agent_changes(run_id,kind,target,before_value,after_value,phase,evidence) VALUES(?,'skill',?,?,?,'prepared',?)").run(runId,args.name,before,after,JSON.stringify(refs)).lastInsertRowid)
  const temp=path+'.review-'+change
  try{
   await writeFile(temp,after,{flag:'wx',mode:0o600});signal?.throwIfAborted()
   if(name==='skill_patch'&&hash(await readFile(path,'utf8'))!==hash(before))throw Error('Skill changed during review')
   if(name==='skill_create')await link(temp,path)
   else await rename(temp,path)
   this.db.transaction(()=>{this.db.prepare("UPDATE atomic_review_agent_changes SET phase='applied' WHERE id=?").run(change);this.record(runId,{id:change,kind:'skill',activation:`Skill: ${args.name}`,principle:name==='skill_patch'?'Updated an existing skill.':'Created a new skill.',evidence:refs,steps:[]})})()
   reads.set(args.name,hash(after));return {name:args.name,saved:true,revision:hash(after)}
  }finally{await unlink(temp).catch(()=>{})}
 }
 async recoverPrepared(){
  for(const row of this.db.prepare("SELECT * FROM atomic_review_agent_changes WHERE kind='skill' AND phase='prepared'").all()){
   let current=null;try{current=await readFile(await this.skillPath(row.target),'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
   if(current===row.after_value){this.db.transaction(()=>{this.db.prepare("UPDATE atomic_review_agent_changes SET phase='applied' WHERE id=?").run(row.id);if(!this.changes(row.run_id).some(change=>change.id===row.id))this.record(row.run_id,{id:row.id,kind:'skill',activation:`Skill: ${row.target}`,principle:'Recovered an interrupted skill update.',evidence:JSON.parse(row.evidence),steps:[]})})()}
   else if(current===row.before_value)this.db.prepare("UPDATE atomic_review_agent_changes SET phase='cancelled' WHERE id=?").run(row.id)
   else throw Error('An interrupted skill edit conflicts with a later change; no automatic overwrite was made')
  }
 }
 diagnostics(){const count=this.db.prepare('SELECT count(*) AS n FROM atomic_review_observations').get().n;const last=this.db.prepare('SELECT state,reason,created_at AS createdAt FROM atomic_review_observations ORDER BY created_at DESC LIMIT 1').get();return {observed:count,last:last??null}}
 owns(runId){return !!this.db.prepare('SELECT 1 FROM atomic_review_agent_changes WHERE run_id=?').get(runId)}
 async undo(runId){
  const run=this.db.prepare('SELECT * FROM atomic_review_runs WHERE id=?').get(runId);if(!run||run.undone_at)throw Error('Review is missing or already undone')
  const rows=this.db.prepare("SELECT * FROM atomic_review_agent_changes WHERE run_id=? AND phase='applied' ORDER BY id DESC").all(runId)
  const expected=new Map()
  for(const row of rows){if(row.kind==='skill'){const current=expected.has(row.target)?expected.get(row.target):await readFile(await this.skillPath(row.target),'utf8');if(current!==row.after_value)throw Error('Skill changed after this review; undo the newer edit first');expected.set(row.target,row.before_value)}else if(this.notes.database().get(Number(row.target))?.content!==row.after_value)throw Error('Note changed after review')}
  for(const row of rows){if(row.kind==='skill'){const path=await this.skillPath(row.target);if(row.before_value===null){await unlink(path);await rmdir(join(this.skillsRoot,row.target)).catch(()=>{})}else await writeFile(path,row.before_value,{mode:0o600})}else this.notes.call({action:'forget',id:Number(row.target)});this.db.prepare("UPDATE atomic_review_agent_changes SET phase='undone' WHERE id=?").run(row.id)}
  this.db.prepare('UPDATE atomic_review_runs SET undone_at=? WHERE id=?').run(Date.now(),runId);return {undone:true,id:runId}
 }
}

/** Only unchanged, current skill revisions are offered as relevant learned hints.
 * Full skill bodies remain available through the normal slash-skill interface. */
export function learnedSkillHints(db, workspace, query) {
 const words=String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word=>word.length>1)??[]
 if(!words.length||!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='atomic_review_agent_changes'").get())return []
 const rows=db.prepare("SELECT c.*,r.undone_at FROM atomic_review_agent_changes c JOIN atomic_review_runs r ON r.id=c.run_id WHERE c.kind='skill' AND c.phase='applied' AND r.undone_at IS NULL ORDER BY c.id DESC LIMIT 100").all()
 const seen=new Set(),hints=[]
 for(const row of rows){
  if(seen.has(row.target))continue;seen.add(row.target)
  try{
   const root=join(workspace,'..','agent-skills'),folder=join(root,row.target),path=join(folder,'SKILL.md')
   if(!slug(row.target)||lstatSync(root).isSymbolicLink()||lstatSync(folder).isSymbolicLink()||lstatSync(path).isSymbolicLink()||lstatSync(path).size>100000)continue
   const current=readFileSync(path,'utf8');if(current!==row.after_value)continue
   const match=/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(current);if(!match)continue
   const meta=parse(match[1]),topic=(row.target+' '+meta.description+' '+match[2]).toLowerCase()
   if(!words.some(word=>topic.includes(word)))continue
   hints.push({id:`review-skill:${row.id}`,content:`Learned workflow /${row.target}: ${meta.description}\n${match[2].slice(0,1600)}`,sessionId:`background-review:${row.run_id}`})
   if(hints.length>=2)break
  }catch{}
 }
 return hints
}
