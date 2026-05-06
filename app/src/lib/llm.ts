/* ============================================================
   多模型适配层
   支持 Kimi / Gemini / Claude / DeepSeek / 自定义 OpenAI 兼容
   ============================================================ */

export type ModelProvider = 'kimi' | 'gemini' | 'claude' | 'deepseek' | 'custom'

export interface LLMConfig {
  provider: ModelProvider
  apiKey: string
  baseUrl?: string
  model?: string
  featureType?: 'interpretation' | 'yearly-fortune' | 'match-analysis' | 'life-kline'
  enableThinking?: boolean
  enableWebSearch?: boolean
  searchApiKey?: string  // Tavily API Key
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onToken?: (token: string) => void
  onComplete?: (fullText: string) => void
  onError?: (error: Error) => void
}

/* ------------------------------------------------------------
   Provider 配置（导出供设置面板使用）
   ------------------------------------------------------------ */

export const PROVIDER_CONFIGS: Record<ModelProvider, { baseUrl: string; defaultModel: string }> = {
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0905-preview',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.0-flash',
  },
  claude: {
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-4-5-20251124',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  custom: {
    baseUrl: '',
    defaultModel: '',
  },
}

/* ------------------------------------------------------------
   Tavily 搜索 (用于无原生搜索的模型)
   ------------------------------------------------------------ */

interface TavilyResult {
  title: string
  url: string
  content: string
}

async function searchWithTavily(query: string, apiKey: string): Promise<string> {
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
      }),
    })

    if (!response.ok) {
      console.warn('Tavily search failed:', response.status)
      return ''
    }

    const data = await response.json()
    const results = data.results as TavilyResult[] || []

    if (results.length === 0) return ''

    // 格式化搜索结果
    const formatted = results.map((r, i) =>
      `[${i + 1}] ${r.title}\n${r.content}\n来源: ${r.url}`
    ).join('\n\n')

    return formatted
  } catch (err) {
    console.warn('Tavily search error:', err)
    return ''
  }
}

/* ------------------------------------------------------------
   智能搜索关键词提取 (用 LLM 提取精准搜索词)
   ------------------------------------------------------------ */

async function extractSearchKeywords(
  _config: LLMConfig,
  chartContext: string
): Promise<string[]> {
  try {
    const coreTokens = ['命宫', '财帛宫', '官禄宫', '夫妻宫', '化禄', '化权', '化科', '化忌']
    const matched = coreTokens.filter((token) => chartContext.includes(token)).slice(0, 3)

    if (matched.length === 0) {
      return [
        '紫微斗数 命宫 主星 解读',
        '紫微斗数 四化 飞星 分析',
        '紫微斗数 三方四正 格局',
      ]
    }

    return matched.map((token) => `紫微斗数 ${token} 解读`)
  } catch (err) {
    console.warn('Keyword extraction failed:', err)
    return []
  }
}

/* ------------------------------------------------------------
   智能联网搜索 (先提取关键词，再搜索)
   ------------------------------------------------------------ */

async function performSmartSearch(
  config: LLMConfig,
  messages: ChatMessage[]
): Promise<string> {
  const { searchApiKey } = config

  if (!searchApiKey) return ''

  // 从 messages 中提取命盘上下文
  const userMessage = messages.find(m => m.role === 'user')?.content || ''

  // 用 LLM 提取搜索关键词
  const keywords = await extractSearchKeywords(config, userMessage)

  if (keywords.length === 0) {
    console.warn('No keywords extracted, skipping search')
    return ''
  }

  console.log('Search keywords:', keywords)

  // 对每个关键词进行搜索
  const allResults: string[] = []

  for (const keyword of keywords.slice(0, 3)) {
    const result = await searchWithTavily(keyword, searchApiKey)
    if (result) {
      allResults.push(`【${keyword}】\n${result}`)
    }
  }

  if (allResults.length === 0) return ''

  return `\n\n---\n【联网搜索参考资料】\n以下是针对命盘关键要素的搜索结果，请结合这些资料进行更准确的解读：\n\n${allResults.join('\n\n')}\n---\n\n`
}

/* ------------------------------------------------------------
   OpenAI 兼容格式请求 (Kimi, DeepSeek, Custom)
   ------------------------------------------------------------ */

async function* streamOpenAICompatible(
  config: LLMConfig,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  const { provider, model, featureType, enableThinking, enableWebSearch, searchApiKey } = config
  let processedMessages = messages

  // 仅在前端配置了 Tavily 时预先补充搜索资料，然后交给 Worker 统一转发。
  if (enableWebSearch && searchApiKey) {
    const searchResult = await performSmartSearch(config, messages)
    if (searchResult) {
      processedMessages = messages.map((m, i) =>
        i === 0 && m.role === 'system'
          ? { ...m, content: m.content + searchResult }
          : m
      )
    }
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      stream: true,
      provider,
      model,
      featureType,
      enableThinking,
      enableWebSearch,
      messages: processedMessages,
    }),
  })

  if (!response.ok) {
    throw new Error(`Worker Proxy Error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        try {
          const json = JSON.parse(data)
          const content =
            json.choices?.[0]?.delta?.content ||
            json.delta?.text ||
            json.text ||
            json.token ||
            ''
          if (content) yield content
        } catch {
          // 忽略解析错误
        }
      }
    }
  }
}

/* ------------------------------------------------------------
   Gemini API 请求
   ------------------------------------------------------------ */

async function* streamGemini(
  config: LLMConfig,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  yield* streamOpenAICompatible(config, messages)
}

/* ------------------------------------------------------------
   Claude API 请求（支持 extended thinking）
   ------------------------------------------------------------ */

async function* streamClaude(
  config: LLMConfig,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  yield* streamOpenAICompatible(config, messages)
}

/* ------------------------------------------------------------
   统一流式接口
   ------------------------------------------------------------ */

export async function* streamChat(
  config: LLMConfig,
  messages: ChatMessage[]
): AsyncGenerator<string> {
  switch (config.provider) {
    case 'gemini':
      yield* streamGemini(config, messages)
      break
    case 'claude':
      yield* streamClaude(config, messages)
      break
    case 'kimi':
    case 'deepseek':
    case 'custom':
    default:
      yield* streamOpenAICompatible(config, messages)
      break
  }
}

/* ------------------------------------------------------------
   便捷调用方法
   ------------------------------------------------------------ */

export async function chat(
  config: LLMConfig,
  messages: ChatMessage[],
  callbacks?: StreamCallbacks
): Promise<string> {
  let fullText = ''

  try {
    for await (const token of streamChat(config, messages)) {
      fullText += token
      callbacks?.onToken?.(token)
    }
    callbacks?.onComplete?.(fullText)
  } catch (error) {
    callbacks?.onError?.(error as Error)
    throw error
  }

  return fullText
}
