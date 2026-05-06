# Cloudflare Worker 代理模式（方案B）

前端已改为统一请求同源 `POST /api/chat`。  
你需要在 Cloudflare Worker 中实现该路由，并通过 Variables and Secrets 控制上游模型配置。

## 必要变量

- Variable: `LLM_BASE_URL`（例如 `https://xxx.trycloudflare.com/v1`）
- Variable: `LLM_MODEL`（例如 `Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf`）
- Secret: `LLM_API_KEY`（上游需要鉴权时设置；免鉴权可留空）

## 请求契约

前端会发送：

```json
{
  "stream": true,
  "provider": "custom",
  "model": "optional-from-ui",
  "enableThinking": false,
  "enableWebSearch": false,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

## Worker 示例（SSE 透传）

```ts
export interface Env {
  LLM_BASE_URL: string
  LLM_MODEL: string
  LLM_API_KEY?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      const body = await request.json() as {
        messages: Array<{ role: string; content: string }>
        model?: string
      }

      const upstreamModel = body.model || env.LLM_MODEL
      const upstreamUrl = `${env.LLM_BASE_URL}/chat/completions`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (env.LLM_API_KEY && env.LLM_API_KEY.trim() !== '') {
        headers['Authorization'] = `Bearer ${env.LLM_API_KEY}`
      }

      const upstreamResp = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: upstreamModel,
          messages: body.messages,
          stream: true,
        }),
      })

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    return new Response('Not Found', { status: 404 })
  },
}
```

## 生效方式

更新 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 后，Worker 新请求会按新值转发。  
前端不需要改代码或重新部署。
