interface Env {
  LLM_BASE_URL?: string
  LLM_MODEL?: string
  LLM_API_KEY?: string
}

interface ChatRequestBody {
  model?: string
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.LLM_BASE_URL || !env.LLM_MODEL) {
    return jsonResponse(
      {
        error: 'Missing required Variables',
        required: ['LLM_BASE_URL', 'LLM_MODEL'],
      },
      500
    )
  }

  let body: ChatRequestBody
  try {
    body = (await request.json()) as ChatRequestBody
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: '`messages` is required' }, 400)
  }

  const upstreamUrl = `${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`
  // 方案B要求模型由 Worker Variables 统一托管，不接受前端覆盖。
  const upstreamModel = env.LLM_MODEL.trim()

  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (env.LLM_API_KEY?.trim()) {
    headers.set('Authorization', `Bearer ${env.LLM_API_KEY}`)
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: upstreamModel,
      messages: body.messages,
      stream: true,
    }),
  })

  if (!upstreamResponse.ok) {
    const detail = await upstreamResponse.text()
    return jsonResponse(
      {
        error: 'Upstream request failed',
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        detail: detail.slice(0, 4000),
      },
      502
    )
  }

  if (!upstreamResponse.body) {
    return jsonResponse({ error: 'Upstream response has no body' }, 502)
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
