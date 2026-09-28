// Outbound HTTP to URLs that did not come from our own configuration (e.g. a signed URL returned by a
// storage service) goes through safeRequest(): HTTPS only, no credentials in the URL, and every IP the
// host resolves to must be public. The check runs inside the socket's DNS lookup, so the address that
// was validated is exactly the address that is connected to (no DNS-rebinding window). Redirects are
// not followed.
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32],
  ["64:ff9b::", 96], // NAT64 (any embedded IPv4, incl. hex form)
  ["64:ff9b:1::", 48],
  ["2002::", 16], // 6to4
  ["2001::", 32], // Teredo
  ["fec0::", 10], // deprecated site-local
] as const)
  blocked.addSubnet(network, prefix, "ipv6");

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** True for loopback, private, link-local, metadata, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped / NAT64 forms carry an IPv4 address that must be checked as such.
    const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (embedded) return blocked.check(embedded[1], "ipv4");
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return blocked.check(
        `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`,
        "ipv4"
      );
    }
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP at all: refuse
}

/** Static checks that need no DNS. */
export function assertSafeUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Некорректный адрес");
  }
  if (url.protocol !== "https:")
    throw new UnsafeUrlError("Разрешены только HTTPS-адреса");
  if (url.username || url.password)
    throw new UnsafeUrlError("Адрес с учётными данными запрещён");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  )
    throw new UnsafeUrlError("Внутренние адреса запрещены");
  if (isIP(host) && isPrivateAddress(host))
    throw new UnsafeUrlError("Внутренние адреса запрещены");
  if (url.port && !["443"].includes(url.port))
    throw new UnsafeUrlError("Нестандартный порт запрещён");
  return url;
}

type LookupFn = (
  hostname: string,
  options: any,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
) => void;

/** DNS lookup that refuses any private address (used by the socket itself). */
export const guardedLookup: LookupFn = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some(entry => isPrivateAddress(entry.address)))
      return callback(new UnsafeUrlError("Внутренние адреса запрещены"), "", 0);
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export async function safeRequest(
  raw: string,
  options: {
    method?: "GET" | "PUT" | "POST";
    headers?: Record<string, string>;
    body?: Buffer;
    maxBytes?: number;
    timeoutMs?: number;
  } = {}
): Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }> {
  const url = assertSafeUrlShape(raw);
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        lookup: guardedLookup as any,
        timeout: options.timeoutMs ?? 20_000,
      },
      response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            request.destroy(new UnsafeUrlError("Ответ слишком большой"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: response.headers,
          })
        );
        response.on("error", reject);
      }
    );
    request.on("timeout", () =>
      request.destroy(new UnsafeUrlError("Превышено время ожидания"))
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}
