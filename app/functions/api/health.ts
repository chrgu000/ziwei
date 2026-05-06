interface Env {
  LLM_BASE_URL?: string
  LLM_MODEL?: string
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return new Response(
    JSON.stringify({
      ok: true,
      hasBaseUrl: Boolean(env.LLM_BASE_URL),
      hasModel: Boolean(env.LLM_MODEL),
    }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    }
  )
}
