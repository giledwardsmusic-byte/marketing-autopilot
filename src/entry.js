import base from './index.js';
import { ensureAutopilotCampaigns } from './lib/autopilot-maintenance.js';
import { health, resolveHealth } from './lib/db.js';

export default {
  fetch: base.fetch,
  async scheduled(controller,env,ctx){
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
