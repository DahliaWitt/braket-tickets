export async function handleHealthCheck(): Promise<Response> {
  return new Response(
    JSON.stringify({status: 'ok', timestamp: Date.now()}),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
