function parseConfig(connector){
  try { return JSON.parse(connector?.config_json || '{}'); }
  catch { return null; }
}

export function connectorPreflight(connector, post={}) {
  if (!connector) return {ok:false,errors:['Connector is missing']};
  const errors=[];
  const cfg=parseConfig(connector);
  if (!cfg) errors.push('Connector config_json is invalid JSON');
  if (!connector.enabled) errors.push('Connector is disabled');

  const type=connector.connector_type;
  const hasSecret=Boolean(connector.secret_ciphertext);
  if (type !== 'sandbox' && !hasSecret) errors.push('Connector credential is not stored');

  if (cfg) {
    if (type==='buffer' && !cfg.channel_id) errors.push('Buffer channel_id is missing');
    if (type==='meta_facebook' && !cfg.page_id) errors.push('Facebook page_id is missing');
    if (type==='meta_instagram') {
      if (!cfg.ig_user_id) errors.push('Instagram ig_user_id is missing');
      if (!post.public_token) errors.push('Instagram requires an approved graphic');
      if (post.mime_type && post.mime_type!=='image/jpeg') errors.push('Instagram direct publishing requires JPEG creative');
    }
    if (type==='pinterest') {
      if (!cfg.board_id) errors.push('Pinterest board_id is missing');
      if (!post.public_token) errors.push('Pinterest requires an approved graphic');
    }
    if (type==='mailerlite') {
      for (const key of ['from','from_name','group_id','html_template']) if (!cfg[key]) errors.push(`MailerLite ${key} is missing`);
    }
  }

  if (!['buffer','meta_facebook','meta_instagram','pinterest','mailerlite','sandbox'].includes(type)) errors.push(`Unsupported connector type: ${type}`);
  return {ok:errors.length===0,errors};
}
