const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const error = (message, status) => json({message}, status);
const validId = id => /^[a-f0-9]{64}$/.test(id);
const ttl = {expirationTtl:86400};
const fresh = {cacheTtl:30};
const draftOptions = {type:'json', ...fresh};

async function submit(request, inbox) {
  const maxBytes = 8 * 1024 * 1024;
  if (request.headers.get('Content-Type') !== 'image/jpeg') return error('请选择比赛截图。',415);
  const length = Number(request.headers.get('Content-Length'));
  if (length > maxBytes) return error('图片超过大小限制。',413);
  if (!request.body) return error('没有收到图片。',400);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return error('图片超过大小限制。',413);
    }
    chunks.push(value);
  }
  const image = new Uint8Array(await new Blob(chunks).arrayBuffer());
  if ((length && image.length !== length) || image[0] !== 255 || image[1] !== 216 || image[2] !== 255)
    return error('图片格式无效，请重新复制截图。',400);
  const hash = await crypto.subtle.digest('SHA-256',image);
  const id = Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,'0')).join('');
  const result = await inbox.get('result/'+id,draftOptions);
  if (result?.ownerSaved && result.draft) return json(result);
  if (result) await inbox.delete('result/'+id);
  if (!await inbox.get('pending/'+id,{type:'stream', ...fresh})) {
    const queue = await inbox.list({prefix:'pending/',limit:32});
    if (queue.keys.length >= 32) return error('截图队列暂时已满，请稍后再试。',429);
    await inbox.put('pending/'+id,image,ttl);
    // The periodic sweep also picks up simultaneous submissions when this hint is throttled.
    await inbox.put('recent',crypto.randomUUID(),ttl).catch(()=>{});
  }
  return json({job:id},202);
}

export async function onRequest(context) {
  const {request} = context;
  const path = new URL(request.url).pathname;
  const origin = request.headers.get('Origin');
  const allowFallback = origin === 'https://hhdota.xyz' && (
    path === '/api/health' || path === '/api/recognize' || path.startsWith('/api/recognition/')
  );
  if (request.method === 'OPTIONS' && !allowFallback) return error('接口不存在。',404);
  let response;
  if (request.method === 'OPTIONS') {
    response = new Response(null,{status:204});
  } else {
    try {
      response = await handleRequest(context);
    } catch (err) {
      console.error('Screenshot API:', err);
      response = error('截图服务暂时无法连通，请稍后重试。',503);
    }
  }
  if (allowFallback) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    response.headers.append('Vary', 'Origin');
  }
  return response;
}

async function handleRequest({request,env}) {
  const path = new URL(request.url).pathname;
  const inbox = env.SCREENSHOTS;
  if (!inbox) return error('截图收件箱尚未连接。',503);
  if (path === '/api/health') return json({queued:true, aiConfigured:!!await inbox.get('online',fresh)});
  if (path === '/api/recognize' && request.method === 'POST') return submit(request,inbox);
  if (path.startsWith('/api/recognition/') && request.method === 'GET') {
    const id = path.split('/').pop();
    if (!validId(id)) return error('无效的任务编号。',400);
    const result = await inbox.get('result/'+id,draftOptions);
    if (result) return json(result,result.draft ? 200 : 422);
    return json({status:'pending'},202);
  }
  if (path === '/api/import-drafts') return json({drafts:[]});
  if (path.startsWith('/api/agent/') && request.method === 'POST') {
    if (!env.AGENT_KEY || request.headers.get('Authorization') !== 'Bearer '+env.AGENT_KEY)
      return error('无权访问。',403);
    if (path === '/api/agent/next') {
      const recent = await inbox.get('recent',fresh) || 'empty';
      if (request.headers.get('X-Previous') === recent) return new Response(null,{status:204});
      const page = await inbox.list({prefix:'pending/',limit:16});
      for (const item of page.keys) {
        const id = item.name.slice(8);
        const result = await inbox.get('result/'+id);
        if (result) { await inbox.delete(item.name); continue; }
        const image = await inbox.get(item.name,{type:'stream', ...fresh});
        if (image) return new Response(image,{headers:{'X-Job':id,'Content-Type':'image/jpeg','Cache-Control':'no-store'}});
      }
      return new Response(null,{status:204,headers:{'X-Recent':recent}});
    }
    if (path === '/api/agent/heartbeat') {
      await inbox.put('online','1',{expirationTtl:600});
      return json({ok:true});
    }
    if (path === '/api/agent/complete') {
      const {id,result} = await request.json();
      if (!validId(id) || !(result?.draft || result?.message)) return error('无效结果。',400);
      await inbox.put('result/'+id,JSON.stringify(result),ttl);
      await inbox.delete('pending/'+id);
      return json({saved:true});
    }
  }
  return error('接口不存在。',404);
}
