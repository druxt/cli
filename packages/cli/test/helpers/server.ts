import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface TestServer {
  url: string
  /** The responses by path. Add to it after the server has a URL. */
  files: Record<string, string | Buffer>
  /** Every request received, in order. */
  requests: { path: string; headers: IncomingHttpHeaders }[]
  close(): Promise<void>
}

/**
 * Serves fixed responses from a loopback port the operating system picks.
 * A path that is not listed answers 404.
 */
export async function serve(
  files: Record<string, string | Buffer>
): Promise<TestServer> {
  const requests: TestServer['requests'] = []
  const server = createServer((request, response) => {
    const path = request.url ?? '/'
    requests.push({ path, headers: request.headers })
    const body = files[path]
    if (body === undefined) {
      response.writeHead(404, 'Not Found').end('not found')
      return
    }
    response.writeHead(200).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    files,
    requests,
    // Closing twice is allowed, so a test may replace its server early.
    close: () =>
      new Promise((resolve, reject) => {
        if (!server.listening) return resolve()
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

/** A loopback URL nothing listens on. */
export async function closedPort(): Promise<string> {
  const server = await serve({})
  await server.close()
  return server.url
}
