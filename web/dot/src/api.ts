import { config } from '../../src/config.ts'

const baseUrl = config.apiBase.replace(/\/$/, '')

async function request(path: string, options: RequestInit = {}, token?: string) {
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

export async function previewImage(id: string, token: string, signal?: AbortSignal) {
  return (await request(`/previews/${id}/image`, { signal }, token)).blob()
}

export function imageUrl(path: string) {
  return /^https?:\/\//i.test(baseUrl) ? new URL(path, baseUrl).href : path
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
