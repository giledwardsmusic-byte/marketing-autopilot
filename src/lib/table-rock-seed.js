const BUDDY_COPY = [
  `Buddy once thought courage meant never being afraid.\n\nThen he discovered something important.\n\nThe bravest creatures in the Whispering Forest weren't the ones who never felt fear. They were the ones who kept moving forward even when they did.\n\nEvery journey begins with a single uncertain step.\n\nWhat step are you taking today?`,
  `The forest didn't change Buddy's life because it was magical.\n\nIt changed his life because he finally stopped running long enough to listen.\n\nSometimes the answers we're searching for aren't hidden.\n\nThey're simply waiting in the quiet places we've forgotten to visit.\n\n#WhisperingForest #BuddyTheBorderCollie #ChildrensBooks`,
  `When Buddy first entered the forest, he felt small.\n\nThe trees were taller. The paths were unfamiliar. The future was uncertain.\n\nBut every friend he met taught him the same lesson:\n\nYou don't have to be the biggest, strongest, or smartest to belong.\n\nYou only have to be yourself.`,
  `One of my favorite things about Buddy is that he makes mistakes.\n\nHe gets lost. He worries. He doubts himself.\n\nJust like the rest of us.\n\nYet somehow he keeps finding his way forward.\n\nMaybe that's why his story feels so familiar.\n\n#BuddyAndTheWhisperingForest`,
  `The Whispering Forest is filled with wise owls, patient squirrels, clever foxes, and ancient trees.\n\nBut sometimes the character who teaches the biggest lesson is a young border collie simply trying to find where he belongs.\n\nThat's Buddy's story.\n\nAnd in one way or another, it's all of our story.`
];

const PRODUCT_ID='prd_table_rock_buddy';
const SOURCE='imported';

const normalizeCopy=text=>String(text||'')
  .replace(/\r/g,'')
  .replace(/[\u2018\u2019]/g,"'")
  .replace(/[\u201C\u201D]/g,'"')
  .replace(/\s+/g,' ')
  .trim()
  .toLowerCase();

function preferredCopy(rows){
  return [...rows].sort((a,b)=>{
    const aDrive=String(a.id||'').startsWith('cpy_drive_')?1:0;
    const bDrive=String(b.id||'').startsWith('cpy_drive_')?1:0;
    if(aDrive!==bDrive)return bDrive-aDrive;
    const aUsed=Number(a.use_count||0),bUsed=Number(b.use_count||0);
    if(aUsed!==bUsed)return bUsed-aUsed;
    return String(a.created_at||'').localeCompare(String(b.created_at||''));
  })[0];
}

export async function ensureTableRockPressSeed(env){
  const existing=await env.DB.prepare(`SELECT id FROM products WHERE id=?`).bind(PRODUCT_ID).first();
  if(!existing){
    const t=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO products(id,name,product_type,brand,short_description,audience,features_json,benefits_json,currency,status,manual_priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(PRODUCT_ID,'Buddy and the Whispering Forest','book','Table Rock Press','A gentle woodland story about courage, belonging, mistakes, and finding your way.','Children and families','[]','[]','USD','paused',1,t,t).run();
  }

  let rows=(await env.DB.prepare(`SELECT id,text,status,source,use_count,created_at FROM copy_items WHERE product_id=?`).bind(PRODUCT_ID).all()).results||[];
  let inserted=0;

  for(let i=0;i<BUDDY_COPY.length;i++){
    const target=BUDDY_COPY[i];
    const equivalent=rows.find(r=>normalizeCopy(r.text)===normalizeCopy(target)&&r.status!=='retired');
    if(equivalent)continue;
    const cid=`cpy_table_rock_buddy_${i+1}`;
    const byId=rows.find(r=>r.id===cid);
    if(byId){
      const t=new Date().toISOString();
      await env.DB.prepare(`UPDATE copy_items SET text=?,status='approved',updated_at=? WHERE id=?`).bind(target,t,cid).run();
      byId.text=target;byId.status='approved';
      continue;
    }
    const t=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO copy_items(id,product_id,copy_type,text,audience,purpose,tone,length_class,campaign_type,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(cid,PRODUCT_ID,'caption',target,'Children and families','engagement','warm','medium','story','approved',SOURCE,t,t).run();
    rows.push({id:cid,text:target,status:'approved',source:SOURCE,use_count:0,created_at:t});
    inserted++;
  }

  rows=(await env.DB.prepare(`SELECT id,text,status,source,use_count,created_at FROM copy_items WHERE product_id=?`).bind(PRODUCT_ID).all()).results||[];
  const groups=new Map();
  for(const row of rows){
    const key=normalizeCopy(row.text);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }

  let retiredDuplicates=0;
  const t=new Date().toISOString();
  for(const group of groups.values()){
    const active=group.filter(r=>r.status!=='retired');
    if(active.length<2)continue;
    const keep=preferredCopy(active);
    for(const row of active){
      if(row.id===keep.id)continue;
      const result=await env.DB.prepare(`UPDATE copy_items SET status='retired',updated_at=? WHERE id=? AND status<>'retired'`).bind(t,row.id).run();
      retiredDuplicates+=Number(result.meta?.changes||0);
    }
  }

  return {product_id:PRODUCT_ID,copy_items:BUDDY_COPY.length,inserted,retired_duplicates:retiredDuplicates};
}
