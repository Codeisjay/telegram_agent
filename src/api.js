export async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    if (response.status === 404) {
      throw new Error('Backend API route not found (404). This Vercel deployment serves the dashboard, but its API backend is not deployed.')
    }
    throw new Error(`The API returned a non-JSON response (HTTP ${response.status}).`)
  }

  try {
    return await response.json()
  } catch {
    throw new Error('The API returned invalid JSON.')
  }
}
