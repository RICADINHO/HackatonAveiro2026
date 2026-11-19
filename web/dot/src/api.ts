const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

async function request(path: string, options: RequestInit = {}, token?: string) {
  if (!baseUrl) throw new Error('O endereço da API ainda não está configurado.')
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (typeof options.body === 'string') headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new Error('Não foi possível contactar a API.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : `Pedido recusado (${response.status}).`
    throw new Error(detail)
  }
  return response
}

export async function api<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  const response = await request(path, options, token)
  return response.status === 204 ? (undefined as T) : response.json()
}

export async function previewImage(id: string, token: string) {
  return (await request(`/previews/${id}/image`, {}, token)).blob()
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
