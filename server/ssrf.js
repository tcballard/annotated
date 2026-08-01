import dns from 'node:dns/promises';
import net from 'node:net';

const privateIpv4 = (address) => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
};

export const blockedHostname = (hostname) => {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1' || value.endsWith('.localhost')) return true;
  if (value.endsWith('.internal') || value.endsWith('.local')) return true;
  return isBlockedAddress(value);
};

export const isBlockedAddress = (address) => {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(value);
  if (family === 4) return privateIpv4(value);
  if (family !== 6) return false;
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value.startsWith('ff')) return true;
  if (value.startsWith('::ffff:')) return isBlockedAddress(value.slice('::ffff:'.length));
  return false;
};

const normalizedRecords = (result) => Array.isArray(result) ? result : result?.address ? [result] : [];

export async function assertPublicUrl(value, { lookup = dns.lookup } = {}) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https sources are supported.');
  if (blockedHostname(url.hostname)) throw new Error('That source host is not allowed.');
  if (net.isIP(url.hostname)) return url;
  let records;
  try {
    records = normalizedRecords(await lookup(url.hostname, { all: true, verbatim: true }));
  } catch {
    throw new Error('The source host could not be resolved.');
  }
  if (!records.length || records.some((record) => isBlockedAddress(record.address))) throw new Error('That source host is not allowed.');
  return url;
}
