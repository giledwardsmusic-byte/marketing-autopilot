import test from 'node:test';
import assert from 'node:assert/strict';
import { publishPinterestPin } from '../src/lib/pinterest-direct.js';

function response(status,data){
  return {ok:status>=200&&status<300,status,async json(){return data;}};
}

test('publishes an image Pin with bounded title and description',async()=>{
  let seen;
  const result=await publishPinterestPin({
    token:'tok',boardId:'board-1',imageUrl:'https://example.test/media.jpg',
    title:'T'.repeat(120),description:'D'.repeat(900),link:'https://example.test/r/abc',
    fetchImpl:async(url,opts)=>{seen={url,opts};return response(201,{id:'pin-123'});}
  });
  assert.equal(result.externalId,'pin-123');
  assert.equal(result.state,'published');
  assert.equal(seen.url,'https://api.pinterest.com/v5/pins');
  assert.equal(seen.opts.headers.authorization,'Bearer tok');
  const body=JSON.parse(seen.opts.body);
  assert.equal(body.board_id,'board-1');
  assert.equal(body.media_source.source_type,'image_url');
  assert.equal(body.media_source.url,'https://example.test/media.jpg');
  assert.equal(body.title.length,100);
  assert.equal(body.description.length,800);
});

test('fails closed on Pinterest API errors',async()=>{
  await assert.rejects(
    ()=>publishPinterestPin({token:'tok',boardId:'board-1',imageUrl:'https://example.test/media.jpg',fetchImpl:async()=>response(401,{message:'Invalid access token'})}),
    /Pinterest 401: Invalid access token/
  );
});

test('rejects successful responses without a Pin id',async()=>{
  await assert.rejects(
    ()=>publishPinterestPin({token:'tok',boardId:'board-1',imageUrl:'https://example.test/media.jpg',fetchImpl:async()=>response(201,{})}),
    /returned no Pin id/
  );
});

test('requires token, board and media before network call',async()=>{
  await assert.rejects(()=>publishPinterestPin({boardId:'b',imageUrl:'https://x.test/a.jpg'}),/access token/);
  await assert.rejects(()=>publishPinterestPin({token:'t',imageUrl:'https://x.test/a.jpg'}),/board_id/);
  await assert.rejects(()=>publishPinterestPin({token:'t',boardId:'b'}),/image URL/);
});
