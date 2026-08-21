import base from './index.js';
import { ensureAutopilotCampaigns } from './lib/autopilot-maintenance.js';
import { health, resolveHealth } from './lib/db.js';
import { ensureSchema } from './lib/schema-bootstrap.js';
import { ensureSandboxConnectors } from './lib/sandbox.js';
import { currentUser } from './lib/auth.js';
import { nowIso } from './lib/utils.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});

async function approveWholeWeek(request,env){
  const user=await currentUser(env,request);
  if(!user)return json({error:'Authentication required'},401);
  if(user.role==='viewer')return json({error:'Viewer accounts are read-only'},403);
  let input={};try{input=await request.json()}catch{}
  const weekStart=String(input.week_start||'');
  if(!weekStart)return json({error:'week_start is required'},400);
  const campaign=await env.DB.prepare(`SELECT id FROM campaigns WHERE week_start=? ORDER BY generated_at DESC LIMIT 1`).bind(weekStart).first();
  if(!campaign)return json({error:'No campaign found for that week'},404);
  const t=nowIso();
  const result=await env.DB.prepare(`UPDATE scheduled_posts SET status='approved',updated_at=? WHERE campaign_id=? AND status IN ('scheduled','paused')`).bind(t,campaign.id).run();
  await env.DB.prepare(`UPDATE campaigns SET status='active' WHERE id=?`).bind(campaign.id).run();
  return json({ok:true,approved:Number(result.meta?.changes||0),campaign_id:campaign.id});
}

export default {
  async fetch(request,env,ctx){
    await ensureSchema(env);
    await ensureSandboxConnectors(env);
    const url=new URL(request.url);
    if(url.pathname==='/api/week/approve'&&request.method==='POST')return approveWholeWeek(request,env);
    return base.fetch(request,env,ctx);
  },
  async scheduled(controller,env,ctx){
    await ensureSchema(env);
    await ensureSandboxConnectors(env);
    await base.scheduled(controller,env,ctx);
    if(controller.cron==='17 3 * * *'){
      try{
        await ensureAutopilotCampaigns(env);
        await resolveHealth(env,'autopilot:campaigns');
      }catch(e){
        await health(env,'autopilot:campaigns','yellow',`Autopilot campaign preparation failed: ${String(e.message||e).slice(0,220)}`);
      }
    }
  }
};
