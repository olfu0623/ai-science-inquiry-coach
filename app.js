// 先在下方填入 Supabase 專案 URL 與 anon key；不要把 OpenAI API Key 放在這裡。
const SUPABASE_URL = "https://zuglugfhmwbxuvnxbizd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_14MGnM1zean0yIUicrEbNw_jBgf0HjS";

const $ = (id) => document.getElementById(id);
const supabaseReady = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("YOUR_") && !SUPABASE_ANON_KEY.includes("YOUR_");
const db = supabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser = null, currentProject = null, currentStage = "topic", projects = [], stageRecords = [];
let stageDirty = false, stageSaving = false, autosaveTimer = null;
let chatHistory=[];

const stageNames = {
  topic: ["主題發想與可行性","先從你觀察到的現象或感到好奇的事情開始。"],
  question: ["形成研究問題","把興趣轉化成清楚、可觀察、可探究的問題。"],
  hypothesis: ["建立科學假設","提出可被證據支持或推翻的預測，並說明理由。"],
  design: ["實驗設計與變因控制","思考自變因、應變因、控制變因、器材與步驟。"],
  data: ["數據整理與分析","檢視資料品質、趨勢、圖表與可能的不確定度。"],
  discussion: ["結果討論與反思","連結證據與主張，討論限制、誤差與後續研究。"]
};

function setStatus(id, msg, error=false){ const el=$(id); el.textContent=msg; el.classList.toggle("error",error); }
function showApp(on){ $("auth-panel").classList.toggle("hidden",on); $("app-panel").classList.toggle("hidden",!on); $("class-toolbar").classList.toggle("hidden",!on); $("teacher-panel").classList.add("hidden"); $("logout-btn").classList.toggle("hidden",!on); }
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

async function init(){
  if(!db){ setStatus("auth-status","請先依 README 設定 Supabase URL 與 anon key。",true); return; }
  const {data:{session}}=await db.auth.getSession();
  if(session){currentUser=session.user; await enterApp();}
  db.auth.onAuthStateChange(async(_event,session)=>{currentUser=session?.user||null;if(currentUser) await enterApp(); else {teacherClasses=[];renderPromptClassOptions();showApp(false);$("user-email").textContent="";}});
}
async function signIn(signup){
  if(!db){setStatus("auth-status","尚未設定 Supabase 連線資訊。",true);return;}
  const email=$("email").value.trim(),password=$("password").value;
  if(!email||password.length<6){setStatus("auth-status","請輸入有效 Email 與至少 6 位元密碼。",true);return;}
  const result=signup?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
  if(result.error){setStatus("auth-status",result.error.message,true);return;}
  if(signup&&!result.data.session){setStatus("auth-status","帳號已建立，請先至信箱完成驗證，再登入。");}
  else {currentUser=result.data.user;await enterApp();}
}
async function enterApp(){
  showApp(true);$("user-email").textContent=currentUser.email||"已登入";
  await loadProjects();
  await loadTeacherClasses();
}
async function loadProjects(){
  const {data,error}=await db.from("projects").select("*").eq("user_id",currentUser.id).order("updated_at",{ascending:false});
  if(error){alert("讀取專題失敗："+error.message);return;}
  projects=data||[];renderProjects();
  if(currentProject){const found=projects.find(p=>p.id===currentProject.id);if(found){currentProject=found;renderProjectHeader();return;}}
  if(projects.length) selectProject(projects[0].id); else showEmpty();
}
function renderProjects(){
  $("project-list").innerHTML=projects.map(p=>`<button class="project-item ${currentProject?.id===p.id?"active":""}" data-id="${p.id}">${escapeHtml(p.title)}<small>${new Date(p.updated_at).toLocaleDateString("zh-TW")}</small></button>`).join("");
  document.querySelectorAll(".project-item").forEach(b=>b.addEventListener("click",()=>selectProject(b.dataset.id)));
}
function showEmpty(){$("empty-state").classList.remove("hidden");$("project-view").classList.add("hidden");currentProject=null;renderProjects();}
async function selectProject(id){
  if(aiRequestInProgress){alert("請等待 AI 回覆完成後再切換專題。");return;}
  if(currentProject && stageDirty){
    const ok = await saveStage();
    if(!ok) return;
  }
  clearTimeout(autosaveTimer);
  currentProject=projects.find(p=>p.id===id);if(!currentProject)return;
  $("empty-state").classList.add("hidden");$("project-view").classList.remove("hidden");
  switchStudentView("inquiry");
  currentStage="topic";await loadStageRecords();setStage("topic");renderProgress();renderProjectHeader();renderProjects();await loadMessages();await loadChatSharing();await loadStudentFeedback();$("student-diagnose-output").textContent="";$("student-diagnose-status").textContent="";await loadDiagnosisHistory(currentProject.id,"student",$("student-diagnosis-history"));await loadResearchConsent(currentProject.id);
}
// 學生工作區與學習診斷中心為同頁獨立視圖；不更動 Supabase 資料與診斷邏輯。
function switchStudentView(view){
 const diagnosis=view==="diagnosis";
 $("inquiry-workspace-view").classList.toggle("hidden",diagnosis);
 $("diagnosis-center-view").classList.toggle("hidden",!diagnosis);
 $("inquiry-view-btn").classList.toggle("active",!diagnosis);
 $("diagnosis-view-btn").classList.toggle("active",diagnosis);
 for(const [id,selected] of [["inquiry-view-btn",!diagnosis],["diagnosis-view-btn",diagnosis]]){
  if(selected)$(id).setAttribute("aria-current","page");else $(id).removeAttribute("aria-current");
 }
 if(diagnosis&&currentProject){renderStudentAnalytics();loadDiagnosisHistory(currentProject.id,"student",$("student-diagnosis-history"));}
}
$("inquiry-view-btn").addEventListener("click",()=>switchStudentView("inquiry"));
$("diagnosis-view-btn").addEventListener("click",async()=>{
 if(!currentProject)return;
 if(stageDirty){const ok=await saveStage();if(!ok)return;}
 switchStudentView("diagnosis");
});
$("diagnosis-back-btn").addEventListener("click",()=>switchStudentView("inquiry"));

function renderProjectHeader(){$("project-title").textContent=currentProject.title;$("project-description").textContent=currentProject.description||"尚未填寫研究簡介";}
function setStage(stage){
  clearTimeout(autosaveTimer);
  stageDirty=false;
  currentStage=stage;
  document.querySelectorAll(".stage").forEach(b=>b.classList.toggle("active",b.dataset.stage===stage));
  $("stage-caption").textContent="專題連續對話｜目前引導："+stageNames[stage][0];
  $("message-input").placeholder=stageNames[stage][1]+" 也可以告訴我你目前的想法…";
  const record=stageRecords.find(r=>r.stage===stage);
  $("work-title").textContent=stageNames[stage][0]+"｜成果紀錄";
  $("work-hint").textContent=stageNames[stage][1]+" 將重要成果整理在此，方便日後接續研究。";
  $("stage-work").value=record?.content||"";
  const done=record?.status==="completed";
  $("stage-status").textContent=done?"已完成":(record?.content?"進行中":"尚未開始");
  $("stage-status").classList.toggle("done",done);
  $("mark-stage-btn").textContent=done?"取消完成標記":"標記為已完成";
  $("save-status").textContent=record?"已載入上次儲存的成果":"尚無成果紀錄";
  renderStudentFeedback();
  renderStudentAnalytics();
}
async function loadStageRecords(){
  const {data,error}=await db.from("project_stages").select("*").eq("project_id",currentProject.id);
  if(error){alert("讀取階段成果失敗："+error.message);stageRecords=[];return;}
  stageRecords=data||[];
}
function renderProgress(){
  const done=stageRecords.filter(r=>r.status==="completed").length;
  $("progress-label").textContent=`${done} / 6 階段完成`;
  $("progress-fill").style.width=`${done/6*100}%`;
  const labels={topic:"主題發想",question:"研究問題",hypothesis:"科學假設",design:"實驗設計",data:"數據分析",discussion:"討論反思"};
  document.querySelectorAll(".stage").forEach(b=>{const r=stageRecords.find(x=>x.stage===b.dataset.stage);b.classList.toggle("stage-done",r?.status==="completed");b.title=r?.status==="completed"?labels[b.dataset.stage]+"（已完成）":labels[b.dataset.stage];});
}
async function saveStage(status){
  if(!currentProject || stageSaving) return false;
  clearTimeout(autosaveTimer);
  const projectId=currentProject.id, stage=currentStage;
  const content=$("stage-work").value.trim();
  const old=stageRecords.find(r=>r.stage===stage);
  const nextStatus=status||(old?.status==="completed"?"completed":(content?"in_progress":"not_started"));
  if(nextStatus==="completed" && !content){
    $("save-status").textContent="請先填寫本階段成果，再標記完成";
    return false;
  }
  const payload={project_id:projectId,user_id:currentUser.id,stage,content,status:nextStatus,updated_at:new Date().toISOString()};
  stageSaving=true;
  $("save-status").textContent="儲存中…";
  const {data,error}=await db.from("project_stages").upsert(payload,{onConflict:"project_id,stage"}).select().single();
  stageSaving=false;
  if(error){$("save-status").textContent="儲存失敗："+error.message;return false;}
  stageRecords=stageRecords.filter(r=>r.stage!==stage);stageRecords.push(data);
  if(currentProject?.id===projectId && currentStage===stage){
    if($("stage-work").value.trim()===content) stageDirty=false;
    const done=data.status==="completed";
    $("stage-status").textContent=done?"已完成":(content?"進行中":"尚未開始");
    $("stage-status").classList.toggle("done",done);
    $("mark-stage-btn").textContent=done?"取消完成標記":"標記為已完成";
    $("save-status").textContent="已儲存 · "+new Date().toLocaleTimeString("zh-TW");
    if(stageDirty) scheduleAutosave();
  }
  renderProgress();
  return true;
}
function scheduleAutosave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(()=>{if(stageDirty && !stageSaving) saveStage();},1200);
}
async function switchStage(stage){
  if(stage===currentStage)return;
  if(stageDirty){const ok=await saveStage();if(!ok)return;}
  setStage(stage);
  renderStudentFeedback();
}

async function loadMessages(){
  const {data,error}=await db.from("messages").select("*").eq("project_id",currentProject.id).order("created_at",{ascending:true});
  if(error){alert("讀取對話失敗："+error.message);return;}
  chatHistory=data||[];
  renderChatHistory();
  if(aiRequestInProgress)showAiWaiting();
}
function renderChatHistory(){
  const data=chatHistory;
  $("chat-log").innerHTML="";
  if(!data.length)addBubble("ai","你好！我是你的 AI 科學探究教練。先告訴我：你最近觀察到什麼有趣的現象，或最想解開哪個科學問題？");
  data.forEach(m=>addBubble(m.role==="assistant"?"ai":"user",m.content,m.stage));
}
function addBubble(role,text,stage){
  const el=document.createElement("div");el.className="bubble "+role;
  if(stage){const tag=document.createElement("small");tag.className="chat-stage-label";tag.textContent=stageNames[stage]?.[0]||stage;el.appendChild(tag);}
  const body=document.createElement("div");body.textContent=text;el.appendChild(body);
  $("chat-log").appendChild(el);$("chat-log").scrollTop=$("chat-log").scrollHeight;
}
async function createProject(){
  const title=$("new-title").value.trim(),description=$("new-description").value.trim();
  if(!title)return;
  const {data,error}=await db.from("projects").insert({user_id:currentUser.id,title,description}).select().single();
  if(error){alert("建立失敗："+error.message);return;}
  $("project-dialog").close();$("project-form").reset();await loadProjects();selectProject(data.id);
}
let aiRequestInProgress=false;
function showAiWaiting(){
  removeAiWaiting();
  const el=document.createElement("div");el.id="ai-waiting";el.className="bubble ai ai-waiting";
  el.setAttribute("role","status");el.setAttribute("aria-live","polite");
  const label=document.createElement("span");label.textContent="AI 教練正在思考中";
  const dots=document.createElement("span");dots.className="ai-wait-dots";dots.setAttribute("aria-hidden","true");
  for(let i=0;i<3;i++){const dot=document.createElement("span");dots.appendChild(dot);}
  el.append(label,dots);$("chat-log").appendChild(el);
  $("chat-log").scrollTop=$("chat-log").scrollHeight;
}
function removeAiWaiting(){document.getElementById("ai-waiting")?.remove();}
async function sendMessage(e){
  e.preventDefault();if(!currentProject||aiRequestInProgress)return;
  const content=$("message-input").value.trim();if(!content)return;
  const projectId=currentProject.id, stage=currentStage;
  aiRequestInProgress=true;
  $("message-input").value="";
  addBubble("user",content,stage);
  $("send-btn").disabled=true;$("send-btn").textContent="AI 回覆中…";
  showAiWaiting();
  try{
    const save=await db.from("messages").insert({project_id:projectId,user_id:currentUser.id,role:"user",content,stage});
    if(save.error)throw new Error("訊息儲存失敗："+save.error.message);
    const {data,error}=await db.functions.invoke("coach",{body:{project_id:projectId,stage}});
    if(error)throw new Error("目前無法連接 AI 教練："+error.message);
    await loadMessages();
    if(!data?.reply)addBubble("ai","我暫時沒有產生回覆，請再試一次。");
  }catch(err){
    removeAiWaiting();
    addBubble("ai",err?.message||"發生未預期錯誤，請稍後再試。");
  }finally{
    removeAiWaiting();
    aiRequestInProgress=false;
    $("send-btn").disabled=false;$("send-btn").textContent="送出 ↗";
  }
}
async function deleteProject(){
  if(aiRequestInProgress){alert("請等待 AI 回覆完成後再刪除專題。");return;}
  clearTimeout(autosaveTimer);
  if(!currentProject||!confirm(`確定刪除「${currentProject.title}」及其對話紀錄？`))return;
  const {error}=await db.from("projects").delete().eq("id",currentProject.id);
  if(error){alert("刪除失敗："+error.message);return;}currentProject=null;await loadProjects();
}

$("login-btn").addEventListener("click",()=>signIn(false));
$("signup-btn").addEventListener("click",()=>signIn(true));
$("logout-btn").addEventListener("click",()=>db?.auth.signOut());
$("new-project-btn").addEventListener("click",()=>$("project-dialog").showModal());
$("empty-new-btn").addEventListener("click",()=>$("project-dialog").showModal());
$("create-project-btn").addEventListener("click",e=>{e.preventDefault();createProject();});
$("chat-form").addEventListener("submit",sendMessage);
$("delete-project-btn").addEventListener("click",deleteProject);
$("save-stage-btn").addEventListener("click",()=>saveStage());
$("mark-stage-btn").addEventListener("click",()=>{const r=stageRecords.find(x=>x.stage===currentStage);saveStage(r?.status==="completed"?"in_progress":"completed");});
document.querySelectorAll(".stage").forEach(b=>b.addEventListener("click",()=>switchStage(b.dataset.stage)));
$("stage-work").addEventListener("input",()=>{
  stageDirty=true;
  $("save-status").textContent="尚未儲存，將自動儲存…";
  scheduleAutosave();
});
init();


// 第三階段：教師班級與學生專題唯讀檢視
let teacherClasses=[];
function teacherMessage(message,error=false){setStatus("teacher-status",message,error);}
function teacherMode(){
  $("app-panel").classList.add("hidden");$("teacher-panel").classList.remove("hidden");
  loadTeacherClasses();
}
async function studentMode(){
  if(stageDirty && currentProject){const ok=await saveStage();if(!ok){alert("請先儲存成果，再切換畫面。");return;}}
  $("teacher-panel").classList.add("hidden");$("app-panel").classList.remove("hidden");
}
async function loadTeacherClasses(){
  if(!currentUser)return;
  const {data,error}=await db.from("inquiry_classes").select("id,name,join_code,created_at").order("created_at",{ascending:false});
  if(error){teacherMessage("班級載入失敗："+error.message,true);const sel=$("prompt-class-select");if(sel)sel.replaceChildren(new Option("班級載入失敗，請重新整理", ""));return;}
  teacherClasses=data||[];
  renderPromptClassOptions();
  renderUsageClassOptions();
  $("teacher-classes").innerHTML=teacherClasses.length?teacherClasses.map(c=>`<div class="teacher-class"><h3>${escapeHtml(c.name)}</h3><p>邀請碼：<strong>${escapeHtml(c.join_code)}</strong></p><div class="teacher-actions"><button class="small" data-teacher-class="${c.id}">查看學生</button><button class="small secondary" data-copy-code="${c.id}">複製邀請碼</button><button class="small danger" data-delete-class="${c.id}">刪除班級</button></div></div>`).join(""):'<p class="muted">目前沒有建立的班級。可以在上方新增班級，並將邀請碼提供給學生。</p>';
  document.querySelectorAll("[data-teacher-class]").forEach(b=>b.addEventListener("click",()=>showTeacherClass(b.dataset.teacherClass)));
  document.querySelectorAll("[data-delete-class]").forEach(b=>b.addEventListener("click",()=>deleteTeacherClass(b.dataset.deleteClass)));
  document.querySelectorAll("[data-copy-code]").forEach(b=>b.addEventListener("click",async()=>{
    const c=teacherClasses.find(x=>x.id===b.dataset.copyCode);
    if(c){try{await navigator.clipboard.writeText(c.join_code);teacherMessage("已複製邀請碼");}catch{teacherMessage("請手動複製邀請碼："+c.join_code);}}
  }));
}
async function deleteTeacherClass(classId){
 const c=teacherClasses.find(x=>x.id===classId);
 if(!c||!currentUser){teacherMessage("找不到班級，請重新載入。",true);return;}
 const typed=window.prompt(`確定刪除「${c.name}」？\n班級成員關聯及班級 Prompt 將移除，學生專題和對話保留。\n請輸入完整班級名稱確認：`);
 if(typed===null)return;
 if(typed!==c.name){teacherMessage("名稱不符，已取消刪除。",true);return;}
 const btn=document.querySelector(`[data-delete-class="${classId}"]`);
 if(btn)btn.disabled=true;
 const {data,error}=await db.from("inquiry_classes").delete().eq("id",classId).eq("teacher_id",currentUser.id).select("id");
 if(error){teacherMessage("刪除失敗："+error.message,true);if(btn)btn.disabled=false;return;}
 if(!data?.length){teacherMessage("未刪除任何班級，請檢查 RLS 權限。",true);if(btn)btn.disabled=false;return;}
 teacherMessage(`已刪除班級「${c.name}」；學生專題和對話仍保留。`);
 await loadTeacherClasses();
}
let promptStageDrafts={};
function renderPromptClassOptions(){
 const sel=$("prompt-class-select");
 if(!sel){teacherMessage("找不到 AI 教練設定的班級選單，請確認 index.html 與 app.js 已同步更新。",true);return;}
 const previous=sel.value;
 sel.replaceChildren();
 sel.add(new Option(teacherClasses.length?"請選擇班級":"目前沒有可用班級", ""));
 for(const c of teacherClasses){
   const opt=document.createElement("option");opt.value=c.id;opt.textContent=c.name;sel.appendChild(opt);
 }
 if(teacherClasses.some(c=>c.id===previous))sel.value=previous;
 else if(teacherClasses.length)sel.value=teacherClasses[0].id;
 sel.disabled=!teacherClasses.length;
 loadClassPrompt();
}
function saveStagePromptDraft(){const stage=$("prompt-stage-select").dataset.previous;
 if(stage)promptStageDrafts[stage]=$("prompt-stage-text").value;
}
async function loadClassPrompt(){
 const classId=$("prompt-class-select").value;
 promptStageDrafts={};$("prompt-general").value="";$("prompt-enabled").checked=false;
 $("prompt-stage-select").value="topic";$("prompt-stage-select").dataset.previous="topic";$("prompt-stage-text").value="";
 if(!classId){setStatus("prompt-status","請先建立班級");return;}
 const {data,error}=await db.from("class_ai_prompts").select("enabled,general_prompt,stage_prompts").eq("class_id",classId).maybeSingle();
 if(error){setStatus("prompt-status","讀取失敗："+error.message,true);return;}
 if($("prompt-class-select").value!==classId)return;
 $("prompt-enabled").checked=!!data?.enabled;$("prompt-general").value=data?.general_prompt||"";
 promptStageDrafts=data?.stage_prompts||{};$("prompt-stage-text").value=promptStageDrafts.topic||"";
 setStatus("prompt-status",data?"已載入本班設定":"本班尚未設定，使用平台預設指令");
}
async function saveClassPrompt(reset=false){
 const classId=$("prompt-class-select").value;
 if(!classId){setStatus("prompt-status","請先選擇班級",true);return;}
 saveStagePromptDraft();
 const stage_prompts={};
 for(const key of Object.keys(stageNames))stage_prompts[key]=String(promptStageDrafts[key]||"").slice(0,3000);
 const payload={class_id:classId,teacher_id:currentUser.id,enabled:reset?false:$("prompt-enabled").checked,general_prompt:reset?"":$("prompt-general").value,stage_prompts:reset?{}:stage_prompts,updated_at:new Date().toISOString()};
 const {error}=await db.from("class_ai_prompts").upsert(payload,{onConflict:"class_id"});
 if(error){setStatus("prompt-status","儲存失敗："+error.message,true);return;}
 setStatus("prompt-status",reset?"已停用並清除自訂指令":"已儲存，學生下次提問時生效");
 if(reset)await loadClassPrompt();
}
$("prompt-class-select").addEventListener("change",loadClassPrompt);
$("prompt-refresh-classes").addEventListener("click",async()=>{setStatus("prompt-status","重新讀取班級中…");await loadTeacherClasses();});
$("prompt-stage-select").addEventListener("change",()=>{
 const stage=$("prompt-stage-select").dataset.previous;
 if(stage)promptStageDrafts[stage]=$("prompt-stage-text").value;
 const next=$("prompt-stage-select").value;
 $("prompt-stage-text").value=promptStageDrafts[next]||"";
 $("prompt-stage-select").dataset.previous=next;
});
$("prompt-save-btn").addEventListener("click",()=>saveClassPrompt(false));
$("prompt-reset-btn").addEventListener("click",()=>{if(confirm("確定停用並清除本班自訂 Prompt？"))saveClassPrompt(true);});
let promptPreviewRunning=false;
$("prompt-preview-run").addEventListener("click",async()=>{
  if(promptPreviewRunning)return;
  const classId=$("prompt-class-select").value;
  const question=$("prompt-preview-question").value.trim();
  if(!classId){setStatus("prompt-preview-status","請先選擇班級",true);return;}
  if(!question){setStatus("prompt-preview-status","請輸入模擬學生問題",true);return;}
  saveStagePromptDraft();
  const stage=$("prompt-stage-select").value;
  const stagePrompts={};
  for(const key of Object.keys(stageNames))stagePrompts[key]=String(promptStageDrafts[key]||"").slice(0,3000);
  promptPreviewRunning=true;$("prompt-preview-run").disabled=true;
  setStatus("prompt-preview-status","AI 正在產生兩組回覆，請稍候…");
  $("prompt-preview-default").textContent="產生中…";
  $("prompt-preview-custom").textContent="產生中…";
  try{
    const {data,error}=await db.functions.invoke("preview-prompt",{body:{
      class_id:classId,stage,question,
      general_prompt:$("prompt-general").value.slice(0,4000),
      stage_prompts:stagePrompts
    }});
    if(error)throw new Error(error.message||"Edge Function 呼叫失敗");
    if(data?.error)throw new Error(data.error);
    $("prompt-preview-default").textContent=data.default_reply||"未取得回覆";
    $("prompt-preview-custom").textContent=data.custom_reply||"未取得回覆";
    setStatus("prompt-preview-status","測試完成。此操作不會儲存草稿；如需套用，請按上方「儲存本班 AI 設定」。");
  }catch(e){setStatus("prompt-preview-status","測試失敗："+(e.message||String(e)),true);
    $("prompt-preview-default").textContent="測試未完成";$("prompt-preview-custom").textContent="測試未完成";
  }finally{promptPreviewRunning=false;$("prompt-preview-run").disabled=false;}
});
async function createTeacherClass(){
 const name=$("class-name").value.trim();if(!name){teacherMessage("請輸入班級名稱",true);return;}
 const {error}=await db.from("inquiry_classes").insert({name,teacher_id:currentUser.id});
 if(error){teacherMessage("建立班級失敗："+error.message,true);return;}
 $("class-name").value="";teacherMessage("班級建立成功");await loadTeacherClasses();
}
async function joinTeacherClass(){
 const p_code=$("join-code").value.trim(),p_name=$("join-name").value.trim();
 if(!p_code||!p_name){setStatus("join-status","請填寫邀請碼及顯示名稱",true);return;}
 const {data,error}=await db.rpc("join_inquiry_class",{p_code,p_name});
 if(error){setStatus("join-status","加入失敗："+error.message,true);return;}
 setStatus("join-status","已加入「"+(data?.[0]?.class_name||"班級")+"」！");
}
async function showTeacherClass(classId){
 const c=teacherClasses.find(x=>x.id===classId);if(!c)return;
 const detail=$("teacher-detail");detail.classList.remove("hidden");detail.innerHTML="<p>讀取學生資料中…</p>";
 const {data:members,error}=await db.from("inquiry_class_members").select("student_id,display_name,joined_at").eq("class_id",classId).order("joined_at");
 if(error){detail.textContent="讀取學生失敗："+error.message;return;}
 const ids=(members||[]).map(m=>m.student_id);
 let projectsForClass=[];
 if(ids.length){const result=await db.from("projects").select("id,user_id,title,description,updated_at").in("user_id",ids).order("updated_at",{ascending:false});
   if(result.error){detail.textContent="讀取專題失敗："+result.error.message;return;}projectsForClass=result.data||[];}
 let stages=[];
 if(projectsForClass.length){const result=await db.from("project_stages").select("project_id,stage,status,content").in("project_id",projectsForClass.map(p=>p.id));
   if(result.error){detail.textContent="讀取進度失敗："+result.error.message;return;}stages=result.data||[];}
 const memberMap=new Map((members||[]).map(m=>[m.student_id,m.display_name]));
 let reviews=[];
 if(projectsForClass.length){const result=await db.from("inquiry_feedback").select("project_id,stage,published,conceptual_reasoning,inquiry_design,evidence_analysis,reflection").eq("teacher_id",currentUser.id).eq("published",true).in("project_id",projectsForClass.map(p=>p.id));
 if(result.error){teacherMessage("學習分析讀取失敗："+result.error.message,true);}else reviews=result.data||[];}
 const summary=buildClassSummary(members||[],projectsForClass,stages,reviews);

 detail.innerHTML=`<h2>${escapeHtml(c.name)} · 學生專題</h2><p class="muted">${ids.length} 位學生，${projectsForClass.length} 個專題。僅供教師檢視，不可修改學生成果。</p>`+
 `<div class="analytics-panel">${summary}</div><section class="analytics-panel" id="research-dashboard"><h3>研究分析（去識別化）</h3><p class="muted">讀取已發布教師評量的歷次快照，按專題比較最早與最新兩次有評分的紀錄。研究匯出僅限學生已同意的專題。</p><button type="button" id="research-analyze-btn" class="small secondary">分析班級能力變化</button><div id="research-analysis-output"></div></section>`+
 (projectsForClass.length?`<table class="teacher-table"><thead><tr><th>學生</th><th>專題</th><th>完成進度</th><th>最近更新</th><th>操作</th></tr></thead><tbody>`+
 projectsForClass.map(p=>{const n=stages.filter(x=>x.project_id===p.id&&x.status==="completed").length;
 return `<tr><td>${escapeHtml(memberMap.get(p.user_id)||"未命名")}</td><td>${escapeHtml(p.title)}</td><td>${n} / 6</td><td>${new Date(p.updated_at).toLocaleDateString("zh-TW")}</td><td><button class="small secondary" data-inspect="${p.id}">查看成果</button></td></tr>`;}).join("")+`</tbody></table>`:'<p class="muted">目前沒有學生專題。學生加入班級並建立專題後，會顯示在這裡。</p>')+`<div id="teacher-project-output"></div>`;
 detail.querySelector("#research-analyze-btn")?.addEventListener("click",()=>runClassResearch(classId,projectsForClass));
 detail.querySelectorAll("[data-inspect]").forEach(b=>b.addEventListener("click",()=>{
  const p=projectsForClass.find(x=>x.id===b.dataset.inspect);if(!p)return;
  const labels={topic:"主題發想",question:"研究問題",hypothesis:"科學假設",design:"實驗設計",data:"數據分析",discussion:"討論反思"};
  $("teacher-project-output").innerHTML=`<h3>${escapeHtml(memberMap.get(p.user_id)||"學生")} · ${escapeHtml(p.title)}</h3><p class="muted">${escapeHtml(p.description||"尚未填寫研究簡介")}</p>`+
  Object.entries(labels).map(([key,label])=>{const r=stages.find(x=>x.project_id===p.id&&x.stage===key);const state=r?.status==="completed"?"已完成":r?.status==="in_progress"?"進行中":"尚未開始";
  return `<details class="teacher-stage"><summary>${escapeHtml(label)} · ${state}</summary><div class="teacher-work">${escapeHtml(r?.content||"尚無成果紀錄")}</div><div class="teacher-review-slot" data-review-stage="${key}"></div></details>`;}).join("");
  const chatBox=document.createElement("section");chatBox.className="analytics-panel chat-teacher-panel";
  chatBox.innerHTML='<h3>學生與 AI 對話歷程</h3><p class="muted tiny">僅能讀取學生同意分享的專題對話；不納入研究匯出。</p><button type="button" class="small secondary">讀取已授權對話</button><p class="status"></p><div class="teacher-chat-results"></div>';
  $("teacher-project-output").appendChild(chatBox);
  chatBox.querySelector("button").addEventListener("click",async()=>{
    const status=chatBox.querySelector(".status"),out=chatBox.querySelector(".teacher-chat-results");status.textContent="讀取中…";out.replaceChildren();
    const {data,error}=await db.from("messages").select("role,content,stage,created_at").eq("project_id",p.id).order("created_at",{ascending:true}).limit(500);
    if(error){status.textContent="讀取失敗："+error.message;return;}
    if(!data?.length){status.textContent="目前沒有可查看的對話（學生可能尚未同意分享）。";return;}
    status.textContent=`已載入 ${data.length} 則訊息（最多 500 則）`;
    for(const m of data){const item=document.createElement("div");item.className="teacher-chat-item";
      const head=document.createElement("strong");head.textContent=(m.role==="assistant"?"AI":"學生")+" · "+(stageNames[m.stage]?.[0]||"未分類")+" · "+new Date(m.created_at).toLocaleString("zh-TW");
      const body=document.createElement("p");body.textContent=m.content;item.append(head,body);out.append(item);}
  });
  const aiBox=document.createElement("section");aiBox.className="analytics-panel ai-diagnosis";
  aiBox.innerHTML='<h3>AI 教師輔助評量</h3><p class="muted tiny">僅供教師參考，不會修改正式評分。</p><button type="button" class="small secondary">產生評量建議</button><p class="status"></p><div class="ai-diagnosis-output"></div>';
  $("teacher-project-output").prepend(aiBox);
  aiBox.querySelector("button").addEventListener("click",()=>runDiagnosis(p.id,"teacher",aiBox.querySelector("button"),aiBox.querySelector(".status"),aiBox.querySelector(".ai-diagnosis-output"),historyBox.querySelector(".diagnosis-history")));
  const historyBox=document.createElement("section");historyBox.className="analytics-panel";historyBox.innerHTML='<h3>教師 AI 診斷歷程</h3><div class="diagnosis-history"></div>';aiBox.after(historyBox);loadDiagnosisHistory(p.id,"teacher",historyBox.querySelector(".diagnosis-history"));
  loadTeacherFeedback(p.id);
  renderTeacherProjectAnalytics(p,stages.filter(x=>x.project_id===p.id),reviews.filter(x=>x.project_id===p.id));
 }));
}
$("student-mode-btn").addEventListener("click",studentMode);
$("teacher-mode-btn").addEventListener("click",teacherMode);
$("create-class-btn").addEventListener("click",createTeacherClass);
$("join-class-open-btn").addEventListener("click",()=>{$("join-status").textContent="";$("join-dialog").showModal();});
$("join-close-btn").addEventListener("click",()=>$("join-dialog").close());
$("join-submit-btn").addEventListener("click",joinTeacherClass);


// 第四階段：教師評量、草稿發布及學生回饋（與 AI 對話分開儲存）
const rubricLabels={conceptual_reasoning:"科學概念與推理",inquiry_design:"探究方法與變因控制",evidence_analysis:"證據分析與解釋",reflection:"反思與改進"};
const rubricLevels={1:"1 起步：需要明確協助",2:"2 發展：已有初步表現",3:"3 熟練：能獨立且合理完成",4:"4 精進：能深入解釋與改進"};
let studentFeedback=[];
async function loadStudentFeedback(){
 if(!currentProject)return;
 const projectId=currentProject.id;
 const {data,error}=await db.from("inquiry_feedback").select("stage,teacher_id,conceptual_reasoning,inquiry_design,evidence_analysis,reflection,comment,updated_at").eq("project_id",projectId).eq("published",true).order("updated_at",{ascending:false});
 if(currentProject?.id!==projectId)return;
 if(error){studentFeedback=[];$("feedback-student-status").textContent="讀取失敗（請先執行 feedback_upgrade.sql）";renderStudentFeedback();return;}
 studentFeedback=data||[];renderStudentAnalytics();$("feedback-student-status").textContent="僅顯示教師已發布內容";renderStudentFeedback();
}
function renderStudentFeedback(){
 const el=$("student-feedback-list");if(!el)return;
 const rows=studentFeedback.filter(r=>r.stage===currentStage);
 if(!rows.length){el.innerHTML='<p class="muted">本階段尚無已發布的教師回饋。</p>';return;}
 el.innerHTML=rows.map(r=>`<article class="feedback-entry"><div class="muted tiny">發布回饋 · ${new Date(r.updated_at).toLocaleString("zh-TW")}</div>${renderRubricReadOnly(r)}<div class="feedback-comment">${escapeHtml(r.comment||"教師未填寫文字回饋")}</div></article>`).join("");
}
function renderRubricReadOnly(r){return `<div class="rubric-summary">${Object.entries(rubricLabels).filter(([k])=>r[k]!=null).map(([k,v])=>`<span><strong>${escapeHtml(v)}</strong>：${r[k]} 級</span>`).join("")}</div>`;}
async function loadTeacherFeedback(projectId){
 const slots=[...document.querySelectorAll("#teacher-project-output [data-review-stage]")];
 const {data,error}=await db.from("inquiry_feedback").select("*").eq("project_id",projectId).eq("teacher_id",currentUser.id);
 if(!document.querySelector("#teacher-project-output [data-review-stage]"))return;
 if(error){slots.forEach(el=>el.textContent="評量載入失敗："+error.message);return;}
 for(const slot of slots){
  const stage=slot.dataset.reviewStage;
  const r=(data||[]).find(x=>x.stage===stage)||{};
  const fields=Object.entries(rubricLabels).map(([key,label])=>`<label>${escapeHtml(label)}<select data-rubric="${key}"><option value="">不評分</option>${Object.entries(rubricLevels).map(([n,name])=>`<option value="${n}" ${String(r[key]??"")===n?"selected":""}>${escapeHtml(name)}</option>`).join("")}</select></label>`).join("");
  slot.innerHTML=`<div class="review-editor"><h4>教師回饋與評量 <span class="muted tiny">${r.published?"已發布":"草稿／尚未發布"}</span></h4><div class="rubric-grid">${fields}</div><label>文字回饋<textarea data-review-comment rows="3" maxlength="5000" placeholder="具體指出學生的優點、證據與下一步建議">${escapeHtml(r.comment||"")}</textarea></label><div class="teacher-actions"><button class="small secondary" type="button" data-review-save="draft">儲存草稿</button><button class="small" type="button" data-review-save="publish">儲存並發布</button></div><p class="status" data-review-status></p></div>`;
  slot.querySelectorAll("[data-review-save]").forEach(btn=>btn.addEventListener("click",()=>saveTeacherFeedback(projectId,stage,slot,btn.dataset.reviewSave==="publish")));
 }
}
async function saveTeacherFeedback(projectId,stage,slot,published){
 const status=slot.querySelector("[data-review-status]");
 const comment=slot.querySelector("[data-review-comment]").value.trim();
 const payload={project_id:projectId,teacher_id:currentUser.id,stage,comment,published,updated_at:new Date().toISOString()};
 for(const key of Object.keys(rubricLabels)){const v=slot.querySelector(`[data-rubric="${key}"]`).value;payload[key]=v?Number(v):null;}
 if(published && !comment && Object.keys(rubricLabels).every(k=>payload[k]===null)){status.textContent="請先填寫評語或至少一項評分。";return;}
 slot.querySelectorAll("[data-review-save]").forEach(b=>b.disabled=true);
 const {error}=await db.from("inquiry_feedback").upsert(payload,{onConflict:"project_id,teacher_id,stage"});
 slot.querySelectorAll("[data-review-save]").forEach(b=>b.disabled=false);
 if(error){status.textContent="儲存失敗："+error.message;return;}
 status.textContent=published?"已發布，學生重新載入專題後即可查看。":"草稿已儲存，學生尚不可見。";
 slot.querySelector("h4 span").textContent=published?"已發布":"草稿／尚未發布";
}


// 第五階段：學習分析與列印報告（不需新增資料表）
const analyticsKeys=["conceptual_reasoning","inquiry_design","evidence_analysis","reflection"];
function rubricMeans(rows){
 const out={};for(const k of analyticsKeys){const values=rows.map(r=>Number(r[k])).filter(v=>v>=1&&v<=4);out[k]=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}return out;
}
function radarSVG(means){
 const cx=140,cy=133,r=94,angles=[-Math.PI/2,0,Math.PI/2,Math.PI];
 const point=(i,scale)=>[cx+Math.cos(angles[i])*r*scale,cy+Math.sin(angles[i])*r*scale];
 const polygon=scale=>angles.map((_,i)=>point(i,scale).map(n=>n.toFixed(1)).join(',')).join(' ');
 const levels=[1,2,3,4].map(n=>`<polygon points="${polygon(n/4)}" fill="none" stroke="currentColor" stroke-opacity=".18"/>`).join('');
 const axes=angles.map((_,i)=>{const [x,y]=point(i,1);return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="currentColor" stroke-opacity=".25"/>`;}).join('');
 const values=analyticsKeys.map(k=>means[k]);
 const shape=values.every(v=>v===null)?'':`<polygon points="${values.map((v,i)=>point(i,(v??0)/4).join(',')).join(' ')}" fill="#168cbd" fill-opacity=".22" stroke="#168cbd" stroke-width="2.5"/>`;
 const labels=['科學概念與推理','探究設計','證據分析','反思改進'];
 const coords=[[140,20],[239,137],[140,252],[41,137]];
 return `<svg viewBox="0 0 280 270" role="img" aria-label="四項探究能力雷達圖，1 至 4 級" class="radar-svg">${levels}${axes}${shape}${labels.map((label,i)=>`<text x="${coords[i][0]}" y="${coords[i][1]}" text-anchor="middle" font-size="11" fill="currentColor">${label}</text>`).join('')}</svg>`;
}
function analyticsMarkup(rows){const means=rubricMeans(rows);return `<div class="radar-figure">${radarSVG(means)}</div><div class="radar-values">${analyticsKeys.map(k=>`<div><strong>${escapeHtml(rubricLabels[k])}</strong><span>${means[k]===null?'尚未評量':means[k].toFixed(2)+' / 4'}</span></div>`).join('')}<p class="muted tiny">共 ${rows.length} 筆已發布評量；同一教師對不同階段的評分各算一筆。</p></div>`;}
function renderStudentAnalytics(){const el=$("student-radar");if(!el)return;el.innerHTML=analyticsMarkup(studentFeedback||[]);}
function buildClassSummary(members,ps,stages,reviews){
 const completed=ps.map(p=>stages.filter(s=>s.project_id===p.id&&s.status==='completed').length);
 const done=completed.reduce((a,b)=>a+b,0),denom=ps.length*6;
 const means=rubricMeans(reviews);
 const count=ps.filter(p=>stages.filter(s=>s.project_id===p.id&&s.status==='completed').length<3).length;
 return `<h3>班級學習分析</h3><div class="analytics-stats"><div><strong>${members.length}</strong><span>班級成員</span></div><div><strong>${ps.length}</strong><span>研究專題</span></div><div><strong>${denom?Math.round(done/denom*100):0}%</strong><span>階段完成率</span></div><div><strong>${count}</strong><span>未達 3 階段的專題</span></div></div><p class="muted tiny">完成率＝已完成階段數／（專題數 × 6）；「未達 3 階段」僅供教師追蹤，不代表能力不足。</p><div class="radar-layout">${analyticsMarkup(reviews)}</div>`;
}
function renderTeacherProjectAnalytics(p,stageRows,reviews){
 const out=$("teacher-project-output");if(!out)return;
 const section=document.createElement('section');section.className='analytics-panel';
 section.innerHTML=`<h3>專題探究能力分析</h3><div class="radar-layout">${analyticsMarkup(reviews)}</div>`;
 out.insertBefore(section,out.querySelector('details'));
}
function reportHtml(){
 if(!currentProject)return '';
 const rows=studentFeedback||[];
 const stages=Object.entries(stageNames).map(([key,[title]])=>{const r=stageRecords.find(s=>s.stage===key);const related=rows.filter(x=>x.stage===key);return `<section class="report-stage"><h2>${escapeHtml(title)}｜${r?.status==='completed'?'已完成':r?.status==='in_progress'?'進行中':'尚未開始'}</h2><div class="report-work">${escapeHtml(r?.content||'尚無成果紀錄')}</div>${related.map(f=>`<div class="report-feedback"><strong>教師回饋</strong><p>${escapeHtml(f.comment||'未填寫文字回饋')}</p><p>${analyticsKeys.filter(k=>f[k]!=null).map(k=>escapeHtml(rubricLabels[k])+': '+Number(f[k])+' 級').join('；')}</p></div>`).join('')}</section>`;}).join('');
 const done=stageRecords.filter(s=>s.status==='completed').length;
 return `<h1>科學探究個人學習歷程報告</h1><p>專題：${escapeHtml(currentProject.title)}</p><p>簡介：${escapeHtml(currentProject.description||'')}</p><p>完成進度：${done} / 6 階段</p><h2>探究能力分析</h2><div class="radar-layout">${analyticsMarkup(rows)}</div>${stages}<p class="muted">本報告僅包含已發布的教師回饋；評量為形成性學習參考。</p>`;
}
$("student-report-btn").addEventListener('click',async()=>{
 if(stageDirty){const ok=await saveStage();if(!ok){alert('請先儲存成果');return;}}
 const w=window.open('','_blank');if(!w){alert('請允許瀏覽器開啟報告視窗');return;}
 const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>科學探究學習歷程報告</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#202a36;max-width:820px;margin:30px auto;padding:20px}h1,h2{color:#1a4861}.report-stage{break-inside:avoid;border-top:1px solid #ccd;padding:12px 0}.report-work{white-space:pre-wrap}.report-feedback{padding:10px;background:#f2f7fa;margin:10px 0}.radar-layout{display:flex;align-items:center;gap:20px}.radar-figure{width:280px}.radar-values>div{display:flex;justify-content:space-between;gap:20px}.radar-svg{width:100%}.muted{color:#666}@media print{body{margin:0}.report-stage{break-inside:avoid}}</style></head><body>${reportHtml()}</body></html>`;
 w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),350);
});

// 第七階段：AI 診斷與已發布教師評量快照，兩者明確分離。
const growthKeys=["conceptual_reasoning","inquiry_design","evidence_analysis","reflection"];
const growthLabels={conceptual_reasoning:"科學概念與推理",inquiry_design:"探究方法與變因控制",evidence_analysis:"證據分析與解釋",reflection:"反思與改進"};
async function loadDiagnosisHistory(projectId,mode,el){
 if(!el)return;
 el.textContent="讀取歷史紀錄中…";
 const {data,error}=await db.from("diagnosis_history").select("id,reply,created_at,ratings_snapshot").eq("project_id",projectId).eq("mode",mode).order("created_at",{ascending:false}).limit(30);
 if(error){el.textContent="無法讀取診斷歷程，請先執行 diagnosis_history_upgrade.sql。";return;}
 if(!data?.length){el.textContent="尚無已儲存的診斷紀錄。";return;}
 const ordered=[...data].reverse();
 const xs=ordered.map((_,i)=>38+i*(520/Math.max(ordered.length-1,1)));
 const lines=growthKeys.map((k,ki)=>{
  const pts=ordered.map((d,i)=>{const val=Number(d.ratings_snapshot?.[k]);return Number.isFinite(val)&&val>=1&&val<=4?{x:xs[i],y:150-(val-1)*38}:null;});
  const color=["#2875ba","#d17a20","#248a69","#9b59b6"][ki];
  const segments=[];let segment=[];
  pts.forEach(p=>{if(p)segment.push(p);else{if(segment.length>1)segments.push(segment);segment=[];}});
  if(segment.length>1)segments.push(segment);
  return segments.map(a=>`<polyline points="${a.map(p=>p.x+","+p.y).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5"/>`).join("")+pts.filter(Boolean).map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}"/>`).join("");
 }).join("");
 const anyRatings=ordered.some(d=>growthKeys.some(k=>d.ratings_snapshot?.[k]!=null));
 const chart=anyRatings?`<div class="growth-chart"><svg viewBox="0 0 600 195" role="img" aria-label="教師已發布評量的歷次快照，縱軸一至四級">${[1,2,3,4].map(v=>`<line x1="32" y1="${150-(v-1)*38}" x2="565" y2="${150-(v-1)*38}" stroke="#cdd7df"/><text x="12" y="${154-(v-1)*38}" font-size="12" fill="currentColor">${v}</text>`).join("")}${lines}<text x="36" y="183" font-size="11" fill="currentColor">${new Date(ordered[0].created_at).toLocaleDateString("zh-TW")}</text><text x="470" y="183" font-size="11" fill="currentColor">${new Date(ordered.at(-1).created_at).toLocaleDateString("zh-TW")}</text></svg><div class="growth-legend">${growthKeys.map((k,i)=>`<span><b style="color:${["#2875ba","#d17a20","#248a69","#9b59b6"][i]}">●</b> ${growthLabels[k]}</span>`).join("")}</div><p class="muted tiny">各點為診斷當時已發布教師評量的平均等級快照；缺少評量時不補零。同一評量未更新時，重複診斷可能呈現相同數值。</p></div>`:'<p class="muted">目前尚無已發布教師評量，無法繪製能力趨勢；仍可查看文字診斷歷程。</p>';
 el.innerHTML=chart+data.map(d=>`<details class="diagnosis-entry"><summary>${new Date(d.created_at).toLocaleString("zh-TW")} · AI 診斷</summary><div class="ai-diagnosis-output">${escapeHtml(d.reply)}</div></details>`).join("");
}
async function runDiagnosis(projectId,mode,button,status,output,historyEl){
 button.disabled=true;status.textContent="AI 正在分析研究證據…";output.textContent="";
 try{
  if(mode==="student"){
   const {data:stages,error:stageError}=await db.from("project_stages").select("content").eq("project_id",projectId);
   if(stageError)throw stageError;
   if(!stages?.some(x=>String(x.content||"").trim())){status.textContent="請先填寫並儲存至少一個階段的研究成果，再使用 AI 診斷。";return;}
  }
  const {data,error}=await db.functions.invoke("diagnose",{body:{project_id:projectId,mode}});
  if(error){let message=data?.error||error.message;try{const response=error.context;if(response?.json){const body=await response.json();message=body?.error||message;}}catch{}throw new Error(message);}
  if(data?.error)throw new Error(data.error);
  const reply=data?.reply;
  if(!reply)throw new Error("AI 沒有產生診斷結果");
  output.textContent=reply;
  const saved=await db.from("diagnosis_history").insert({project_id:projectId,requester_id:currentUser.id,mode,reply});
  if(saved.error){status.textContent="診斷完成，但歷史紀錄儲存失敗："+saved.error.message;return;}
  status.textContent="診斷完成，已儲存歷史紀錄。AI 建議僅供參考。";
  if(historyEl)await loadDiagnosisHistory(projectId,mode,historyEl);
 }catch(e){status.textContent="診斷失敗："+(e.message||String(e));}
 finally{button.disabled=false;}
}
$("student-diagnose-btn").addEventListener("click",async()=>{
 if(!currentProject)return;
 if(stageDirty){const ok=await saveStage();if(!ok)return;}
 await runDiagnosis(currentProject.id,"student",$("student-diagnose-btn"),$("student-diagnose-status"),$("student-diagnose-output"),$("student-diagnosis-history"));
});


// 第八階段：學生可撤回研究匯出同意；教學功能與同意狀態無關。
async function loadResearchConsent(projectId){
 const input=$("research-consent"), status=$("research-consent-status");if(!input)return;
 input.disabled=true;input.checked=false;status.textContent="讀取研究資料同意狀態中…";
 const {data,error}=await db.from("research_consents").select("consented").eq("project_id",projectId).maybeSingle();
 if(currentProject?.id!==projectId)return;
 if(error){status.textContent="無法讀取同意狀態，請先執行 research_upgrade.sql";return;}
 input.checked=data?.consented===true;input.disabled=false;status.textContent="只包含去識別化的評量數值與時間，不包含姓名、研究文字或 AI 對話。";
}
$("research-consent").addEventListener("change",async()=>{
 const projectId=currentProject?.id;if(!projectId)return;
 const input=$("research-consent"),status=$("research-consent-status");input.disabled=true;
 const {error}=await db.from("research_consents").upsert({project_id:projectId,student_id:currentUser.id,consented:input.checked,updated_at:new Date().toISOString()},{onConflict:"project_id"});
 if(error){status.textContent="儲存失敗："+error.message;await loadResearchConsent(projectId);}else{status.textContent=input.checked?"已同意，可隨時取消":"已取消研究匯出同意";input.disabled=false;}
});
function researchSnapshots(rows){
 const keys=["conceptual_reasoning","inquiry_design","evidence_analysis","reflection"];
 return rows.filter(r=>r.ratings_snapshot&&keys.some(k=>Number(r.ratings_snapshot[k])>=1&&Number(r.ratings_snapshot[k])<=4))
  .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
}
async function runClassResearch(classId,projects){
 const output=$("research-analysis-output");if(!output)return;
 output.textContent="讀取研究資料中…";
 if(!projects.length){output.textContent="班級目前沒有專題";return;}
 const ids=projects.map(p=>p.id);
 const [hist,consents]=await Promise.all([
  db.from("diagnosis_history").select("project_id,created_at,ratings_snapshot").eq("mode","student").in("project_id",ids).order("created_at",{ascending:true}).limit(1000),
  db.from("research_consents").select("project_id,consented").in("project_id",ids)
 ]);
 if(hist.error||consents.error){output.textContent="資料讀取失敗："+(hist.error?.message||consents.error?.message);return;}
 const allowed=new Set((consents.data||[]).filter(x=>x.consented===true).map(x=>x.project_id));
 const keys=["conceptual_reasoning","inquiry_design","evidence_analysis","reflection"];
 const labels=["科學概念與推理","探究方法與變因控制","證據分析與解釋","反思與改進"];
 const rows=[];
 for(const p of projects){
  if(!allowed.has(p.id))continue;
  const snapshots=researchSnapshots((hist.data||[]).filter(x=>x.project_id===p.id));
  if(snapshots.length<2)continue;
  const first=snapshots[0],last=snapshots[snapshots.length-1];
  if(first.created_at===last.created_at)continue;
  rows.push({projectId:p.id,first,last});
 }
 const eligible=rows.length;
 const means=keys.map(k=>{
  const pairs=rows.map(r=>[Number(r.first.ratings_snapshot[k]),Number(r.last.ratings_snapshot[k])]).filter(([a,b])=>a>=1&&a<=4&&b>=1&&b<=4);
  return {n:pairs.length,pre:pairs.length?pairs.reduce((s,p)=>s+p[0],0)/pairs.length:null,post:pairs.length?pairs.reduce((s,p)=>s+p[1],0)/pairs.length:null};
 });
 output.innerHTML=`<p>已同意且至少有兩次有效評量快照的專題：<strong>${eligible}</strong> 個。比較最早與最新一次，非標準化前後測。</p>`+
 `<table class="teacher-table"><thead><tr><th>能力指標</th><th>配對數</th><th>首次平均</th><th>最近平均</th><th>差異</th></tr></thead><tbody>`+
 means.map((m,i)=>`<tr><td>${labels[i]}</td><td>${m.n}</td><td>${m.pre===null?'—':m.pre.toFixed(2)}</td><td>${m.post===null?'—':m.post.toFixed(2)}</td><td>${m.pre===null?'—':(m.post-m.pre).toFixed(2)}</td></tr>`).join("")+`</tbody></table>`+
 `<p class="muted tiny">注意：這是同一專題在不同時間的教師評量快照，不是實驗前後測；重複診斷可能沒有新的教師評量。少於 5 個同意專題時停用匯出以降低再識別風險。</p>`+
 `<button id="research-export-btn" type="button" class="small secondary" ${eligible<5?'disabled':''}>匯出研究 CSV（僅同意專題）</button>`;
 output.querySelector("#research-export-btn")?.addEventListener("click",async()=>{
  if(rows.length<5)return;
  // 不輸出專題 ID、姓名、原始文字或逐筆時間；僅輸出四面向配對評量數值。
  const header=["匿名序號",...keys.flatMap(k=>[k+"_first",k+"_latest"])];
  const lines=[header.join(",")];
  for(let i=0;i<rows.length;i++){
   const r=rows[i];lines.push([i+1,...keys.flatMap(k=>{
    const a=Number(r.first.ratings_snapshot[k]),b=Number(r.last.ratings_snapshot[k]);
    return [a>=1&&a<=4?a:"",b>=1&&b<=4?b:""];
   })].join(","));
  }
  const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="inquiry_research_anonymized.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 });
}

// 對話歷程：逐專題分享授權及學生自行匯出
async function loadChatSharing(){
 $("chat-share-teacher").checked=false;$("chat-share-status").textContent="";
 const id=currentProject?.id;if(!id)return;
 const {data,error}=await db.from("chat_sharing_consents").select("allow_teacher_read").eq("project_id",id).maybeSingle();
 if(currentProject?.id!==id)return;
 if(error){$("chat-share-status").textContent="讀取分享設定失敗："+error.message;return;}
 $("chat-share-teacher").checked=!!data?.allow_teacher_read;
}
$("chat-share-teacher").addEventListener("change",async e=>{
 const id=currentProject?.id;if(!id)return;
 const checked=e.target.checked;e.target.disabled=true;
 const {error}=await db.from("chat_sharing_consents").upsert({project_id:id,user_id:currentUser.id,allow_teacher_read:checked,updated_at:new Date().toISOString()},{onConflict:"project_id"});
 e.target.disabled=false;
 if(error){e.target.checked=!checked;$("chat-share-status").textContent="設定失敗："+error.message;return;}
 $("chat-share-status").textContent=checked?"已同意教師查看本專題對話":"已取消教師查看授權";
});
$("chat-export-btn").addEventListener("click",async()=>{
 if(!currentProject)return;
 const {data,error}=await db.from("messages").select("created_at,stage,role,content").eq("project_id",currentProject.id).order("created_at",{ascending:true}).limit(10000);
 if(error){alert("匯出失敗："+error.message);return;}
 const quote=x=>'"'+String(x??"").replace(/"/g,'""').replace(/^[=+@-]/,m=>"'"+m)+'"';
 const rows=[["時間","探究階段","角色","內容"],...(data||[]).map(m=>[m.created_at,stageNames[m.stage]?.[0]||"未分類",m.role==="assistant"?"AI":"學生",m.content])];
 const csv='\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="探究對話歷程.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

// 班級 AI 使用量：教師只可讀取自己班級的彙總數據。
function renderUsageClassOptions(){
 const sel=$("usage-class-select");if(!sel)return;
 const previous=sel.value;sel.replaceChildren(new Option(teacherClasses.length?"請選擇班級":"目前沒有班級",""));
 for(const c of teacherClasses)sel.add(new Option(c.name,c.id));
 if(teacherClasses.some(c=>c.id===previous))sel.value=previous;
 else if(teacherClasses.length)sel.value=teacherClasses[0].id;
}
$("usage-refresh-btn").addEventListener("click",async()=>{
 const classId=$("usage-class-select").value,days=Number($("usage-days").value);
 if(!classId){setStatus("usage-status","請先選擇班級",true);return;}
 setStatus("usage-status","正在讀取使用量…");$("usage-results").replaceChildren();
 const {data,error}=await db.rpc("teacher_ai_usage_summary",{p_class:classId,p_days:days});
 if(error){setStatus("usage-status","讀取失敗："+error.message,true);return;}
 const v=data||{};const summary=document.createElement("p");
 summary.textContent=`呼叫 ${v.calls||0} 次｜輸入 ${Number(v.input_tokens||0).toLocaleString()} tokens｜輸出 ${Number(v.output_tokens||0).toLocaleString()} tokens｜活躍學生 ${v.active_students||0} 人`;
 $("usage-results").appendChild(summary);
 const ul=document.createElement("ul");
 for(const x of v.by_stage||[]){const li=document.createElement("li");li.textContent=`${stageNames[x.stage]?.[0]||x.stage}：${x.calls} 次`;ul.appendChild(li);}
 $("usage-results").appendChild(ul);setStatus("usage-status","統計完成（僅含升級後紀錄）");
});
